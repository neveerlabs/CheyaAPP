import { createServiceRoleClient } from "../src/lib/server-supabase";
import {
  createEmbedding,
  executeChatDataTool,
  findRelevantContext,
  loadAllAssistantFeedback,
  loadChatMessagePage,
  loadInsightsForMessages,
  loadRecentInsights,
  releaseStoredChatAttachment,
  saveChatBranch,
  saveMessageInsight,
} from "../src/lib/chat-data";
import { start } from "workflow/api";
import {
  analyzeGeminiMessage,
  generateGeminiConversation,
  generateThinkingSummary,
  GeminiFailoverError,
  prepareGeminiAttachments,
  transcribeGeminiVoiceNote,
  type GeminiAttachmentReference,
  type GeminiAttempt,
} from "../src/lib/gemini";
import {
  CHAT_ATTACHMENT_BUCKET,
  CHAT_ATTACHMENT_RETENTION_MS,
  MAX_GEMINI_CONTEXT_ATTACHMENTS,
  VOICE_NOTE_TRANSCRIPT_MARKER,
} from "../src/lib/chat-attachments";
import {
  DEFAULT_GEMINI_TTS_VOICE,
  generateGeminiSpeech,
  isGeminiTtsVoice,
} from "../src/lib/gemini-tts";
import { speechTextFromMarkdown } from "../src/lib/speech-text";
import { generateSoundOfTextAudio } from "../src/lib/server-sound-of-text";
import { expireChatAttachmentWorkflow } from "./expire-chat-attachment";
import type { AiBarcodeReading } from "../src/lib/chat-barcode";
import { searchWebWithFallback } from "../src/lib/server-web-search";
import { ACCOUNT_AI_ACTION_NAMES } from "../src/lib/account-ai-actions";
import { executeAccountAiTool } from "../src/lib/server-ai-tools";
import { sendAiFailureToInbox, sendPushToAccount } from "../src/lib/server-push";
import { getSharedAttachmentId, linkChatAttachments } from "../src/lib/chat-attachment-sharing";
import {
  DEFAULT_PERSONALIZATION,
  saveApiStatus,
  type ChatMessageJob,
  type GeminiApiKey,
  type PersonalizationSettings,
  type StoredChatMessage,
} from "../src/lib/supabase";

function hasExplicitDeleteIntent(message: string, label: string): boolean {
  if (!/\b(delete|remove|forget|erase|hapus|buang|lupakan|clean|cleanup|deduplicate|duplicates?|bersihkan|duplikat)\b/i.test(message)) {
    return false;
  }
  const targetPattern =
    /\bmemory\b/i.test(label)
      ? /\b(memory|memories|memori|ingatan)\b/i
      : /\binsight\b/i.test(label)
        ? /\b(insight|insights|analisis|catatan)\b/i
        : /\battachment\b/i.test(label)
          ? /\b(file|files|attachment|attachments|media|lampiran|berkas|foto|photo|picture|gambar|video|document|dokumen)\b/i
          : /\b(message|chat|conversation|pesan|obrolan)\b/i;
  const attachmentName = label.match(/attachment "([^"]+)"/i)?.[1];
  return (
    targetPattern.test(message) ||
    Boolean(attachmentName && message.toLocaleLowerCase().includes(attachmentName.toLocaleLowerCase())) ||
    /\b(this|that|it|these|those|itu|ini|tersebut|yang tadi)\b/i.test(message)
  );
}

function assistantNotificationTitle(response: string): string {
  const firstLine = response.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  const title = firstLine?.replace(/^#{1,6}\s*/, "").replace(/[*_`]/g, "").trim();
  if (!title) throw new Error("The AI response did not include text for a notification title.");
  return title.length > 80 ? `${title.slice(0, 77).trimEnd()}...` : title;
}

async function updateJob(
  jobId: string,
  userId: string,
  values: Partial<Pick<ChatMessageJob, "status" | "progress" | "error" | "updated_at">>,
) {
  "use step";
  const client = createServiceRoleClient();
  const { error } = await client
    .from("chat_message_jobs")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("user_id", userId)
    .neq("status", "completed");
  if (error) throw new Error(`Could not update chat processing status: ${error.message}`);
}

async function markJobFailed(jobId: string, message: string) {
  "use step";
  const client = createServiceRoleClient();
  const { error } = await client
    .from("chat_message_jobs")
    .update({
      status: "failed",
      progress: "Cheya could not complete this response.",
      error: message.slice(0, 2000),
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .neq("status", "completed");
  if (error) throw new Error(`Could not save the chat failure status: ${error.message}`);
  const { data: job, error: jobError } = await client
    .from("chat_message_jobs")
    .select("user_id")
    .eq("id", jobId)
    .maybeSingle();
  if (jobError) throw new Error(`Could not load the failed chat account: ${jobError.message}`);
  if (!job) throw new Error("Could not find the account for the failed chat job.");
  await sendAiFailureToInbox(job.user_id, jobId, message);
}

async function processChatJob(jobId: string, barcodeReadings: AiBarcodeReading[]) {
  "use step";
  const client = createServiceRoleClient();
  const { data: job, error: jobError } = await client
    .from("chat_message_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  if (jobError) throw new Error(`Could not load the chat job: ${jobError.message}`);
  if (!job) throw new Error("The queued chat job no longer exists.");
  if (job.status === "completed" || job.status === "failed") return;

  const { data: userMessage, error: messageError } = await client
    .from("chat_messages")
    .select("id, user_id, role, content, embedding, created_at, version_number, thinking_summary, is_active, revision_reason")
    .eq("id", job.message_id)
    .eq("user_id", job.user_id)
    .maybeSingle();
  if (messageError) throw new Error(`Could not load the queued message: ${messageError.message}`);
  if (!userMessage || userMessage.role !== "user") {
    throw new Error("The queued user message could not be found.");
  }

  const updateProgress = async (progress: string) => {
    if (job.thinking_mode) {
      await updateJob(jobId, job.user_id, { progress });
    }
  };

  await updateJob(jobId, job.user_id, {
    status: "processing",
    progress: job.thinking_mode ? "Loading your chat history and settings…" : "Processing...",
    error: null,
  });

  const [
    { data: keys, error: keysError },
    { data: profile, error: profileError },
    { data: accountProfile, error: accountProfileError },
  ] = await Promise.all([
    client
      .from("ai_api_keys")
      .select("id, model, api_key, status, last_error, created_at")
      .eq("user_id", job.user_id)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
    client
      .from("user_settings")
      .select("display_name, custom_prompt, chat_style, web_search_enabled, tts_api_key, tts_api_keys, tts_voice")
      .eq("user_id", job.user_id)
      .maybeSingle(),
    client
      .from("account_profiles")
      .select("role")
      .eq("user_id", job.user_id)
      .single(),
  ]);
  if (keysError) throw new Error(`Could not load Gemini API configuration: ${keysError.message}`);
  if (profileError) throw new Error(`Could not load Personal settings: ${profileError.message}`);
  if (accountProfileError) {
    throw new Error(`Could not load account role: ${accountProfileError.message}`);
  }
  if (keys.length === 0) throw new Error("Add a Gemini API key in Settings before chatting.");

  const typedKeys: GeminiApiKey[] = keys;
  const personalization: PersonalizationSettings = profile ?? DEFAULT_PERSONALIZATION;
  const attempts: GeminiAttempt[] = [];
  const warnings: string[] = [];
  const sharedAttachmentIds = new Set<string>();
  let adminMessageId: string | null = null;
  let voiceNoteRequested = false;
  let includeVoiceNoteText = false;
  let userMessageContent = userMessage.content;
  let userMessageVersionNumber = userMessage.version_number;

  const { data: currentAudioRows, error: currentAudioError } = await client
    .from("chat_message_attachments")
    .select("id, file_name, mime_type, storage_path, created_at")
    .eq("message_id", userMessage.id)
    .eq("user_id", job.user_id)
    .is("deleted_at", null)
    .gt("expires_at", new Date().toISOString());
  if (currentAudioError) {
    throw new Error(`Could not load the voice note for transcription: ${currentAudioError.message}`);
  }
  const voiceNotes = currentAudioRows
    .filter((attachment) => attachment.mime_type.startsWith("audio/"))
    .map<GeminiAttachmentReference>((attachment) => ({
      id: attachment.id,
      fileName: attachment.file_name,
      mimeType: attachment.mime_type,
      storagePath: attachment.storage_path,
      messageCreatedAt: userMessage.created_at,
    }));
  if (voiceNotes.length > 0) {
    await updateProgress("Listening to your voice message…");
    const transcription = await transcribeGeminiVoiceNote(
      typedKeys,
      voiceNotes,
      async (attachment) => {
        const { data, error } = await client.storage
          .from(CHAT_ATTACHMENT_BUCKET)
          .download(attachment.storagePath);
        if (error) {
          throw new Error(`Could not read the voice note from private storage: ${error.message}`);
        }
        return data;
      },
    );
    attempts.push(...transcription.attempts);
    const transcript = transcription.text.trim();
    const transcriptMarker = `\n\n${VOICE_NOTE_TRANSCRIPT_MARKER}`;
    const existingTranscriptIndex = userMessageContent.lastIndexOf(transcriptMarker);
    userMessageContent =
      userMessageContent === "Please listen to the attached voice note and respond to its content." ||
      userMessageContent === "Please review the attached files."
        ? `${VOICE_NOTE_TRANSCRIPT_MARKER}${transcript}`
        : userMessageContent.startsWith(VOICE_NOTE_TRANSCRIPT_MARKER)
          ? `${VOICE_NOTE_TRANSCRIPT_MARKER}${transcript}`
        : existingTranscriptIndex >= 0
          ? `${userMessageContent.slice(0, existingTranscriptIndex)}${transcriptMarker}${transcript}`
          : `${userMessageContent}${transcriptMarker}${transcript}`;
    if (userMessageContent.length > 50000) {
      throw new Error("The voice note transcript is too long to store as a chat message.");
    }
    const { data: transcriptVersionNumber, error: messageUpdateError } = await client.rpc(
      "save_chat_voice_note_transcript",
      { p_message_id: userMessage.id, p_content: userMessageContent },
    );
    if (messageUpdateError) {
      throw new Error(`Could not save the voice note transcript to the message: ${messageUpdateError.message}`);
    }
    if (typeof transcriptVersionNumber !== "number") {
      throw new Error("The database did not return the voice note message version.");
    }
    userMessageVersionNumber = transcriptVersionNumber;
  }

  const [documentEmbeddingResult, queryEmbeddingResult] = await Promise.allSettled([
    createEmbedding(typedKeys[0].api_key, userMessageContent, "RETRIEVAL_DOCUMENT"),
    createEmbedding(typedKeys[0].api_key, userMessageContent, "RETRIEVAL_QUERY"),
  ]);
  const messageEmbedding: number[] | null =
    documentEmbeddingResult.status === "fulfilled" ? documentEmbeddingResult.value : null;
  const queryEmbedding =
    queryEmbeddingResult.status === "fulfilled"
      ? queryEmbeddingResult.value
      : messageEmbedding;
  if (documentEmbeddingResult.status === "fulfilled") {
    try {
      const serialized = `[${documentEmbeddingResult.value.join(",")}]`;
      const { error: messageUpdateError } = await client
        .from("chat_messages")
        .update({ embedding: serialized })
        .eq("id", userMessage.id)
        .eq("user_id", job.user_id);
      if (messageUpdateError) throw messageUpdateError;
      const { error: versionUpdateError } = await client
        .from("chat_message_versions")
        .update({ embedding: serialized })
        .eq("message_id", userMessage.id)
        .eq("user_id", job.user_id)
        .eq("version_number", userMessageVersionNumber);
      if (versionUpdateError) throw versionUpdateError;
    } catch (error) {
      warnings.push(
        `The message was saved without a searchable embedding: ${
          error instanceof Error ? error.message : "Could not save its embedding."
        }`,
      );
    }
  } else {
    warnings.push(
      `The message was saved without a searchable embedding: ${
        documentEmbeddingResult.reason instanceof Error
          ? documentEmbeddingResult.reason.message
          : "Could not create its embedding."
      }`,
    );
  }
  if (queryEmbeddingResult.status === "rejected" && messageEmbedding) {
    warnings.push("Personal context retrieval is using the message embedding as a fallback.");
  }

  await updateProgress("Checking the active conversation and matching relevant personal context…");
  const historyLimit = job.thinking_mode ? 20 : 6;
  const history = (await loadChatMessagePage(client, {
    limit: historyLimit,
    userId: job.user_id,
  })).messages
    .filter((item) => item.id !== userMessage.id)
    .slice(job.thinking_mode ? -12 : -6);
  const priorInsightsPromise = job.thinking_mode
    ? loadRecentInsights(client, 12, userMessage.id, userMessage.created_at, job.user_id).then(
        (insights) => ({ insights, error: null }),
        (error: unknown) => ({ insights: [], error }),
      )
    : Promise.resolve({ insights: [], error: null });
  let insightAnalysisPromise: Promise<
    | { ok: true; result: Awaited<ReturnType<typeof analyzeGeminiMessage>> | null }
    | { ok: false; error: unknown }
  > = Promise.resolve({ ok: true, result: null });
  const saveInsightAnalysis = async () => {
    if (!job.thinking_mode) return;
    const priorInsights = await priorInsightsPromise;
    if (priorInsights.error) {
      console.error("Could not load prior insights for conversation analysis.", priorInsights.error);
    }
    const analysis = await insightAnalysisPromise;
    if (!analysis.ok) {
      console.error("Conversation insight analysis could not be completed.", analysis.error);
      return;
    }
    if (!analysis.result) return;
    const insight = analysis.result.insight;
    if (
      !insight.summary.trim() &&
      !insight.mood.trim() &&
      !insight.communication_style.trim() &&
      !insight.situation.trim() &&
      insight.topics.length === 0 &&
      !insight.support_needs.trim()
    ) {
      return;
    }
    try {
      const insightEmbeddingText = [
        `Mood: ${insight.mood}`,
        `Communication style: ${insight.communication_style}`,
        `Situation: ${insight.situation}`,
        `Topics: ${insight.topics.join(", ")}`,
        `Support needs: ${insight.support_needs}`,
        `Summary: ${insight.summary}`,
      ]
        .filter((part) => part.split(": ", 2)[1]?.trim())
        .join("\n")
        .slice(0, 6000);
      let insightEmbedding: string | null = null;
      try {
        insightEmbedding = `[${(
          await createEmbedding(
            typedKeys[0].api_key,
            insightEmbeddingText,
            "RETRIEVAL_DOCUMENT",
          )
        ).join(",")}]`;
      } catch (error) {
        console.warn(
          `Conversation insight embedding could not be created for message ${userMessage.id}.`,
          error,
        );
      }
      await saveMessageInsight(
        client,
        userMessage.id,
        insight,
        job.user_id,
        insightEmbedding,
      );
    } catch (error) {
      console.error(`Conversation insight could not be saved for message ${userMessage.id}.`, error);
    }
  };
  const contextResult: PromiseSettledResult<Awaited<ReturnType<typeof findRelevantContext>>> =
    queryEmbedding
      ? await Promise.allSettled([
          findRelevantContext(
            client,
            queryEmbedding,
            userMessage.id,
            undefined,
            job.user_id,
            userMessageContent,
          ),
        ]).then(([result]) => result)
      : {
          status: "rejected",
          reason: new Error("No query embedding was available for personal context retrieval."),
        };
  let retrievedMessages: Awaited<ReturnType<typeof findRelevantContext>>["messages"] = [];
  let memories: Awaited<ReturnType<typeof findRelevantContext>>["memories"] = [];
  let retrievedInsights: Awaited<ReturnType<typeof findRelevantContext>>["insights"] = [];
  if (contextResult.status === "fulfilled") {
    retrievedMessages = contextResult.value.messages;
    memories = contextResult.value.memories;
    retrievedInsights = contextResult.value.insights;
  } else {
    warnings.push(
      `Semantic chat context could not be loaded: ${
        contextResult.reason instanceof Error
          ? contextResult.reason.message
          : "Unknown retrieval error."
      }`,
    );
  }

  const relevantUserMessageIds = retrievedMessages
    .filter((item) => item.role === "user")
    .slice(0, 4)
    .map((item) => item.id);
  const attachmentMessageIds = [
    userMessage.id,
    ...relevantUserMessageIds,
  ];
  const { data: savedAttachments, error: attachmentsError } = await client
    .from("chat_message_attachments")
    .select("id, file_name, mime_type, storage_path, message_id, created_at, expires_at, deleted_at")
    .in("message_id", attachmentMessageIds)
    .is("deleted_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });
  if (attachmentsError) {
    throw new Error(`Could not load unexpired chat attachments: ${attachmentsError.message}`);
  }
  const currentAttachments = savedAttachments.filter(
    (attachment) => attachment.message_id === userMessage.id,
  );
  const barcodeContext = barcodeReadings.flatMap((reading) => {
    const attachment = currentAttachments.find(
      (item) => item.id === reading.attachmentId && item.mime_type.startsWith("image/"),
    );
    return attachment
      ? [{
          fileName: attachment.file_name,
          format: reading.format,
          text: reading.text,
        }]
      : [];
  });
  const messageRelevance = new Map(relevantUserMessageIds.map((id, index) => [id, index]));
  const relevantMediaAttachments = savedAttachments.filter(
    (attachment) =>
      attachment.message_id !== null &&
      attachment.message_id !== userMessage.id &&
      /^(image|video|audio)\//i.test(attachment.mime_type),
  )
    .sort(
      (first, second) =>
        (messageRelevance.get(first.message_id ?? "") ?? Number.MAX_SAFE_INTEGER) -
          (messageRelevance.get(second.message_id ?? "") ?? Number.MAX_SAFE_INTEGER) ||
        second.created_at.localeCompare(first.created_at),
    )
    .slice(0, 3);
  const relevantMessageTime = new Map(
    retrievedMessages.map((item) => [item.id, item.created_at]),
  );
  const attachmentsForModel = [
    ...currentAttachments,
    ...relevantMediaAttachments,
  ]
    .slice(0, MAX_GEMINI_CONTEXT_ATTACHMENTS)
    .map<GeminiAttachmentReference>((attachment) => ({
      id: attachment.id,
      fileName: attachment.file_name,
      mimeType: attachment.mime_type,
      storagePath: attachment.storage_path,
      messageCreatedAt:
        attachment.message_id === userMessage.id
          ? userMessage.created_at
          : (attachment.message_id
              ? relevantMessageTime.get(attachment.message_id)
              : undefined) ?? attachment.created_at,
    }));
  const currentAudioAttachments = attachmentsForModel.filter((attachment) =>
    attachment.mimeType.startsWith("audio/"),
  );
  if (
    job.thinking_mode &&
    (userMessageContent !== "Please review the attached files." || currentAudioAttachments.length > 0)
  ) {
    insightAnalysisPromise = priorInsightsPromise
      .then(({ insights }) =>
        analyzeGeminiMessage(
              typedKeys,
              userMessageContent,
              0,
              history.map(({ role, content, created_at }) => ({ role, content, created_at })),
              userMessage.created_at,
              insights,
              currentAudioAttachments,
              async (attachment) => {
                const { data, error } = await client.storage
                  .from(CHAT_ATTACHMENT_BUCKET)
                  .download(attachment.storagePath);
                if (error) {
                  throw new Error(
                    `Could not read "${attachment.fileName}" for conversation analysis: ${error.message}`,
                  );
                }
                return data;
              },
        ),
      )
      .then(
        (result) => ({ ok: true as const, result }),
        (error: unknown) => ({ ok: false as const, error }),
      );
  }
  const candidateMessageIds = [
    ...retrievedMessages.map((item) => item.id),
    ...history.map((item) => item.id),
  ];
  const [feedbackResult, insightsResult] = await Promise.allSettled([
    loadAllAssistantFeedback(client, job.user_id),
    loadInsightsForMessages(client, [...new Set(candidateMessageIds)], job.user_id, 20, true),
  ]);

  let feedback: Awaited<ReturnType<typeof loadAllAssistantFeedback>> = [];
  if (feedbackResult.status === "fulfilled") feedback = feedbackResult.value;
  else {
    throw new Error(
      `Could not load all saved response feedback before generating a reply: ${
        feedbackResult.reason instanceof Error ? feedbackResult.reason.message : "Unknown error."
      }`,
    );
  }

  let insights: Awaited<ReturnType<typeof loadInsightsForMessages>> = [];
  if (insightsResult.status === "fulfilled") {
    const insightsByMessageId = new Map<
      string,
      (typeof insightsResult.value)[number] | (typeof retrievedInsights)[number]
    >();
    for (const insight of retrievedInsights) {
      insightsByMessageId.set(insight.message_id, insight);
    }
    for (const insight of insightsResult.value) {
      if (!insightsByMessageId.has(insight.message_id)) insightsByMessageId.set(insight.message_id, insight);
    }
    insights = [...insightsByMessageId.values()];
  }
  else {
    warnings.push(
      `Conversation insights could not be loaded: ${
        insightsResult.reason instanceof Error ? insightsResult.reason.message : "Unknown error."
      }`,
    );
    insights = retrievedInsights;
  }
  if (feedbackResult.status === "fulfilled" && insightsResult.status === "fulfilled") {
    const candidateMessageIdSet = new Set(candidateMessageIds);
    const ratedRequestIds = [
      ...new Set(
        feedbackResult.value
          .map((item) => item.requestMessageId)
          .filter((id): id is string => id !== null && !candidateMessageIdSet.has(id)),
      ),
    ];
    if (ratedRequestIds.length > 0) {
      try {
        const ratedInsights = await loadInsightsForMessages(
          client,
          ratedRequestIds,
          job.user_id,
          8,
          true,
        );
        insights = [...ratedInsights, ...insights];
      } catch (error) {
        warnings.push(
          `Insights linked to rated replies could not be loaded: ${
            error instanceof Error ? error.message : "Unknown error."
          }`,
        );
      }
    }
  }

  const relevantMessages = retrievedMessages;

  await updateProgress("Reviewing the full message, its timing, and relevant personal context…");
  const result = await generateGeminiConversation(
    typedKeys,
    userMessageContent,
    0,
    personalization,
    {
      accountRole: accountProfile.role,
      webSearchEnabled: profile?.web_search_enabled !== false,
      thinkingMode: job.thinking_mode,
      allowSilence: true,
      currentMessageAt: userMessage.created_at,
      history: history.map(({ role, content, created_at }) => ({ role, content, created_at })),
      relevantMessages,
      memories,
      insights: insights.slice(0, 12),
      feedback,
      barcodeReadings: barcodeContext,
      attachments: attachmentsForModel,
      prepareAttachments: (key, attachments) =>
        prepareGeminiAttachments(key, attachments, async (attachment) => {
          const { data, error } = await client.storage
            .from(CHAT_ATTACHMENT_BUCKET)
            .download(attachment.storagePath);
          if (error) {
            throw new Error(
              `Could not read "${attachment.fileName}" from private storage: ${error.message}`,
            );
          }
          return data;
        }),
      onToolActivity: async (toolName) => {
        const activity =
          toolName === "search_web"
            ? "Action: Searching the web and inspecting sources…"
            : `Action: Using chat tool "${toolName}"…`;
        await updateProgress(activity);
      },
      executeTool: async (name, input, key) => {
        if (name === "choose_voice_note") {
          voiceNoteRequested = true;
          if (
            typeof input === "object" &&
            input !== null &&
            "include_text" in input &&
            input.include_text === true
          ) {
            includeVoiceNoteText = true;
          }
          return { selected: true };
        }
        if (ACCOUNT_AI_ACTION_NAMES.has(name)) {
          const toolResult = await executeAccountAiTool(
            job.user_id,
            name,
            input,
            userMessage.id,
            { rawProductHelpForServerModel: true },
          );
          if (
            name === "send_message_to_admin" &&
            typeof toolResult === "object" &&
            toolResult !== null &&
            "messageId" in toolResult &&
            typeof toolResult.messageId === "string"
          ) {
            adminMessageId = toolResult.messageId;
          }
          if (name === "share_chat_attachment") {
            const attachmentId = getSharedAttachmentId(toolResult);
            if (!attachmentId) throw new Error("The attachment share action returned an invalid reference.");
            sharedAttachmentIds.add(attachmentId);
          }
          return toolResult;
        }
        if (name === "search_web") {
          if (profile?.web_search_enabled === false) {
            throw new Error("Web search is disabled in General settings.");
          }
          const query =
            typeof input === "object" &&
            input !== null &&
            "query" in input &&
            typeof input.query === "string"
              ? input.query
              : "";
          return searchWebWithFallback(query, typedKeys);
        }
        return executeChatDataTool(
          client,
          key.api_key,
          name,
          input,
          async (label) => hasExplicitDeleteIntent(userMessageContent, label),
          job.user_id,
          userMessage.id,
        );
      },
    },
  );
  attempts.push(...result.attempts);
  warnings.push(...result.toolErrors.map((detail) => `A tool reported an error: ${detail}`));

  if (result.silent) {
    await saveInsightAnalysis();
    for (const attempt of attempts) {
      try {
        await saveApiStatus(client, attempt, job.user_id);
      } catch (error) {
        warnings.push(
          `Gemini API status could not be updated: ${
            error instanceof Error ? error.message : "Unknown database error."
          }`,
        );
      }
    }
    try {
      await saveChatBranch(client, userMessage.id, userMessageVersionNumber, job.user_id);
    } catch (error) {
      warnings.push(
        `The message was saved, but conversation history could not be snapshotted: ${
          error instanceof Error ? error.message : "Unknown database error."
        }`,
      );
    }
    const { error: completionError } = await client
      .from("chat_message_jobs")
      .update({
        status: "completed",
        progress: "Cheya is listening.",
        error: warnings.length > 0 ? warnings.join("\n").slice(0, 2000) : null,
        updated_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("user_id", job.user_id)
      .neq("status", "completed");
    if (completionError) {
      throw new Error(`Could not complete the silent chat job: ${completionError.message}`);
    }
    return;
  }

  let thinkingSummary: string | null = null;
  if (job.thinking_mode) {
    try {
      const summary = await generateThinkingSummary(
        typedKeys,
        userMessageContent,
        result.text,
        {
          currentMessageAt: userMessage.created_at,
          history: history.map(({ role, content, created_at }) => ({
            role,
            content,
            created_at,
          })),
          relevantMessages,
          memories,
          insights,
          feedback,
        },
        result.keyIndex,
      );
      thinkingSummary = summary.summary;
      attempts.push(...summary.attempts);
    } catch (error) {
      if (error instanceof GeminiFailoverError) attempts.push(...error.attempts);
      warnings.push(
        `The answer is ready, but its Thinking summary could not be created: ${
          error instanceof Error ? error.message : "Unknown Gemini error."
        }`,
      );
    }
  }

  await saveInsightAnalysis();
  await updateProgress("Saving Cheya's response…");
  const { data: savedResponses, error: completeError } = await client.rpc("complete_chat_job", {
    p_job_id: jobId,
    p_content: result.text,
    p_embedding: null,
    p_thinking_summary: thinkingSummary,
    p_admin_message_id: adminMessageId,
  });
  if (completeError) throw new Error(`Could not save Cheya's response: ${completeError.message}`);
  const savedResponse = savedResponses[0] as StoredChatMessage | undefined;
  if (!savedResponse) throw new Error("The database did not return the saved response.");

  try {
    const assistantEmbedding = await createEmbedding(
      typedKeys[result.keyIndex].api_key,
      result.text,
      "RETRIEVAL_DOCUMENT",
    );
    const serializedEmbedding = `[${assistantEmbedding.join(",")}]`;
    const [messageUpdate, versionUpdate] = await Promise.all([
      client
        .from("chat_messages")
        .update({ embedding: serializedEmbedding })
        .eq("id", savedResponse.id)
        .eq("user_id", job.user_id),
      client
        .from("chat_message_versions")
        .update({ embedding: serializedEmbedding })
        .eq("message_id", savedResponse.id)
        .eq("user_id", job.user_id)
        .eq("version_number", savedResponse.version_number),
    ]);
    if (messageUpdate.error || versionUpdate.error) {
      throw new Error(messageUpdate.error?.message ?? versionUpdate.error?.message);
    }
  } catch (error) {
    warnings.push(
      `The answer was saved without a searchable embedding: ${
        error instanceof Error ? error.message : "Could not create its embedding."
      }`,
    );
  }

  if (voiceNoteRequested) {
    await updateProgress("Preparing Cheya's voice note…");
    const speechText = speechTextFromMarkdown(result.text);
    const configuredTtsKeys = Array.isArray(profile?.tts_api_keys)
      ? profile.tts_api_keys.filter((key): key is string => typeof key === "string" && Boolean(key.trim()))
      : [];
    const ttsKeys = configuredTtsKeys.length
      ? configuredTtsKeys
      : profile?.tts_api_key?.trim()
        ? [profile.tts_api_key]
        : [];
    const voice = profile?.tts_voice && isGeminiTtsVoice(profile.tts_voice)
      ? profile.tts_voice
      : DEFAULT_GEMINI_TTS_VOICE;
    let generatedAudio: Blob | null = null;
    let audioMimeType = "";
    let geminiTtsError: unknown;

    if (ttsKeys.length > 0) {
      try {
        generatedAudio = await generateGeminiSpeech(ttsKeys, speechText, voice);
        audioMimeType = "audio/wav";
      } catch (error) {
        geminiTtsError = error;
      }
    } else {
      geminiTtsError = new Error("No Gemini TTS API key is configured in the user's settings.");
    }

    if (!generatedAudio || generatedAudio.size > 18 * 1024 * 1024) {
      if (generatedAudio) {
        geminiTtsError = new Error("Gemini TTS audio exceeded the 18 MB storage limit.");
      }
      try {
        generatedAudio = await generateSoundOfTextAudio(speechText);
        audioMimeType = "audio/mpeg";
      } catch (error) {
        warnings.push(
          `The text reply was saved, but voice-note generation failed. Gemini TTS: ${
            geminiTtsError instanceof Error ? geminiTtsError.message : "unknown error."
          } Sound of Text: ${error instanceof Error ? error.message : "unknown error."}`,
        );
      }
    }

    if (generatedAudio) {
      const attachmentId = crypto.randomUUID();
      const storagePath = `${job.user_id}/${attachmentId}`;
      const { error: uploadError } = await client.storage
        .from(CHAT_ATTACHMENT_BUCKET)
        .upload(storagePath, generatedAudio, { contentType: audioMimeType, upsert: false });
      if (uploadError) {
        warnings.push(`The text reply was saved, but its voice note could not be stored: ${uploadError.message}`);
      } else {
        const { error: attachmentError } = await client.from("chat_message_attachments").insert({
          id: attachmentId,
          user_id: job.user_id,
          message_id: savedResponse.id,
          storage_path: storagePath,
          file_name: `cheya-voice-note.${audioMimeType === "audio/wav" ? "wav" : "mp3"}`,
          mime_type: audioMimeType,
          size_bytes: generatedAudio.size,
          show_text: includeVoiceNoteText,
          expires_at: new Date(Date.now() + CHAT_ATTACHMENT_RETENTION_MS).toISOString(),
        });
        if (attachmentError) {
          const { error: cleanupError } = await client.storage
            .from(CHAT_ATTACHMENT_BUCKET)
            .remove([storagePath]);
          warnings.push(
            `The text reply was saved, but its voice note metadata could not be saved: ${attachmentError.message}${
              cleanupError ? ` Storage cleanup also failed: ${cleanupError.message}` : ""
            }`,
          );
        } else {
          try {
            await start(expireChatAttachmentWorkflow, [attachmentId]);
          } catch (error) {
            try {
              await releaseStoredChatAttachment(client, attachmentId, job.user_id);
            } catch (cleanupError) {
              warnings.push(
                `The voice-note expiry could not be scheduled, and immediate cleanup failed: ${
                  cleanupError instanceof Error ? cleanupError.message : "Unknown cleanup error."
                }`,
              );
            }
            warnings.push(
              `The text reply was saved, but its voice note could not be retained for 24 hours: ${
                error instanceof Error ? error.message : "Expiry scheduling failed."
              }`,
            );
          }
        }
      }
    }
  }

  try {
    await linkChatAttachments(
      client,
      job.user_id,
      accountProfile.role,
      savedResponse.id,
      [...sharedAttachmentIds],
    );
  } catch (error) {
    warnings.push(
      `The AI response was saved, but its shared attachments could not be linked: ${
        error instanceof Error ? error.message : "Unknown database error."
      }`,
    );
  }

  for (const attempt of attempts) {
    try {
      await saveApiStatus(client, attempt, job.user_id);
    } catch (error) {
      warnings.push(
        `Gemini API status could not be updated: ${
          error instanceof Error ? error.message : "Unknown database error."
        }`,
      );
    }
  }

  try {
    await saveChatBranch(client, savedResponse.id, savedResponse.version_number, job.user_id);
  } catch (error) {
    warnings.push(
      `The response was saved, but conversation history could not be snapshotted: ${
        error instanceof Error ? error.message : "Unknown database error."
      }`,
    );
  }

  try {
    const push = await sendPushToAccount(
      job.user_id,
      assistantNotificationTitle(result.text),
      result.text.length > 280 ? `${result.text.slice(0, 277)}...` : result.text,
    );
    if (push.failed.length > 0) {
      warnings.push(`The response was saved, but some push notifications failed: ${push.failed.join(" ")}`);
    }
  } catch (error) {
    warnings.push(
      `The response was saved, but its push notification could not be sent: ${
        error instanceof Error ? error.message : "Unknown push service error."
      }`,
    );
  }

  if (warnings.length > 0) {
    const { error: warningError } = await client
      .from("chat_message_jobs")
      .update({
        error: warnings.join("\n").slice(0, 2000),
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("user_id", job.user_id);
    if (warningError) throw new Error(`Could not save response warnings: ${warningError.message}`);
  }
}

export async function createChatResponseWorkflow(
  jobId: string,
  barcodeReadings: AiBarcodeReading[] = [],
) {
  "use workflow";
  try {
    await processChatJob(jobId, barcodeReadings);
  } catch (error) {
    const message = error instanceof Error ? error.message : "An unexpected chat processing error occurred.";
    await markJobFailed(jobId, message);
  }
}
