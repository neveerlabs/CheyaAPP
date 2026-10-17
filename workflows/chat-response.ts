import { createServiceRoleClient } from "../src/lib/server-supabase";
import {
  createEmbedding,
  executeChatDataTool,
  findRelevantContext,
  loadRecentAssistantFeedback,
  loadChatMessagePage,
  loadInsightsForMessages,
  saveChatBranch,
} from "../src/lib/chat-data";
import {
  generateGeminiConversation,
  generateThinkingSummary,
  GeminiFailoverError,
  prepareGeminiAttachments,
  type GeminiAttachmentReference,
  type GeminiAttempt,
} from "../src/lib/gemini";
import { CHAT_ATTACHMENT_BUCKET, MAX_GEMINI_CONTEXT_ATTACHMENTS } from "../src/lib/chat-attachments";
import type { AiBarcodeReading } from "../src/lib/chat-barcode";
import { searchWebWithFallback } from "../src/lib/server-web-search";
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

  await updateJob(jobId, job.user_id, {
    status: "processing",
    progress: "Loading your chat history and settings…",
    error: null,
  });

  const [{ data: keys, error: keysError }, { data: profile, error: profileError }] =
    await Promise.all([
      client
        .from("ai_api_keys")
        .select("id, model, api_key, status, last_error, created_at")
        .eq("user_id", job.user_id)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true }),
      client
        .from("user_settings")
        .select("display_name, custom_prompt, chat_style")
        .eq("user_id", job.user_id)
        .maybeSingle(),
    ]);
  if (keysError) throw new Error(`Could not load Gemini API configuration: ${keysError.message}`);
  if (profileError) throw new Error(`Could not load Personal settings: ${profileError.message}`);
  if (keys.length === 0) throw new Error("Add a Gemini API key in Settings before chatting.");

  const typedKeys: GeminiApiKey[] = keys;
  const personalization: PersonalizationSettings = profile ?? DEFAULT_PERSONALIZATION;
  const attempts: GeminiAttempt[] = [];
  const warnings: string[] = [];

  const [documentEmbeddingResult, queryEmbeddingResult] = await Promise.allSettled([
    createEmbedding(typedKeys[0].api_key, userMessage.content, "RETRIEVAL_DOCUMENT"),
    createEmbedding(typedKeys[0].api_key, userMessage.content, "RETRIEVAL_QUERY"),
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
        .eq("version_number", userMessage.version_number);
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

  await updateJob(jobId, job.user_id, {
    progress: "Checking the active conversation and matching relevant personal context…",
  });
  const history = (await loadChatMessagePage(client, { limit: 20, userId: job.user_id })).messages
    .filter((item) => item.id !== userMessage.id)
    .slice(-12);
  const contextResult: PromiseSettledResult<Awaited<ReturnType<typeof findRelevantContext>>> =
    queryEmbedding
      ? await Promise.allSettled([
          findRelevantContext(client, queryEmbedding, userMessage.id, undefined, job.user_id),
        ]).then(([result]) => result)
      : {
          status: "rejected",
          reason: new Error("No query embedding was available for personal context retrieval."),
        };
  let retrievedMessages: Awaited<ReturnType<typeof findRelevantContext>>["messages"] = [];
  let memories: Awaited<ReturnType<typeof findRelevantContext>>["memories"] = [];
  if (contextResult.status === "fulfilled") {
    retrievedMessages = contextResult.value.messages;
    memories = contextResult.value.memories;
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
      /^(image|video)\//i.test(attachment.mime_type),
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
  const candidateMessageIds = [
    ...retrievedMessages.map((item) => item.id),
    ...history.map((item) => item.id),
  ];
  const assistantIds = [
    ...retrievedMessages.filter((item) => item.role === "assistant").map((item) => item.id),
    ...history.filter((item) => item.role === "assistant").map((item) => item.id),
  ];
  const [feedbackResult, insightsResult] = await Promise.allSettled([
    loadRecentAssistantFeedback(client, [...new Set(assistantIds)], 32, job.user_id),
    loadInsightsForMessages(client, [...new Set(candidateMessageIds)], job.user_id, 20),
  ]);

  let feedback: Awaited<ReturnType<typeof loadRecentAssistantFeedback>> = [];
  if (feedbackResult.status === "fulfilled") feedback = feedbackResult.value;
  else {
    warnings.push(
      `Saved response feedback could not be loaded: ${
        feedbackResult.reason instanceof Error ? feedbackResult.reason.message : "Unknown error."
      }`,
    );
  }

  let insights: Awaited<ReturnType<typeof loadInsightsForMessages>> = [];
  if (insightsResult.status === "fulfilled") insights = insightsResult.value;
  else {
    warnings.push(
      `Conversation insights could not be loaded: ${
        insightsResult.reason instanceof Error ? insightsResult.reason.message : "Unknown error."
      }`,
    );
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

  await updateJob(jobId, job.user_id, {
    progress: job.thinking_mode
      ? "Reviewing the full message, its timing, and relevant personal context…"
      : "Preparing Cheya's reply…",
  });
  const result = await generateGeminiConversation(
    typedKeys,
    userMessage.content,
    0,
    personalization,
    {
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
        await updateJob(jobId, job.user_id, { progress: activity });
      },
      executeTool: (name, input, key) => {
        if (name === "search_web") {
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
          async (label) => hasExplicitDeleteIntent(userMessage.content, label),
          job.user_id,
          userMessage.id,
        );
      },
    },
  );
  attempts.push(...result.attempts);
  warnings.push(...result.toolErrors.map((detail) => `A tool reported an error: ${detail}`));

  if (result.silent) {
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
      await saveChatBranch(client, userMessage.id, userMessage.version_number, job.user_id);
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
        userMessage.content,
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

  let assistantEmbedding: number[] | null = null;
  try {
    assistantEmbedding = await createEmbedding(
      typedKeys[result.keyIndex].api_key,
      result.text,
      "RETRIEVAL_DOCUMENT",
    );
  } catch (error) {
    warnings.push(
      `The answer will be saved without a searchable embedding: ${
        error instanceof Error ? error.message : "Could not create its embedding."
      }`,
    );
  }

  await updateJob(jobId, job.user_id, { progress: "Saving Cheya's response…" });
  const { data: savedResponses, error: completeError } = await client.rpc("complete_chat_job", {
    p_job_id: jobId,
    p_content:
      warnings.length > 0
        ? `${result.text}\n\n> Note: ${warnings.join(" ")}`
        : result.text,
    p_embedding: assistantEmbedding ? `[${assistantEmbedding.join(",")}]` : null,
    p_thinking_summary: thinkingSummary,
  });
  if (completeError) throw new Error(`Could not save Cheya's response: ${completeError.message}`);
  const savedResponse = savedResponses[0] as StoredChatMessage | undefined;
  if (!savedResponse) throw new Error("The database did not return the saved response.");

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

  if (warnings.length > 0) {
    const { error: warningError } = await client
      .from("chat_message_jobs")
      .update({
        progress: warnings.join("\n").slice(0, 2000),
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
