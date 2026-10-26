import type {
  AppSupabaseClient,
  ChatMessageVersion,
  MessageInsight,
  StoredChatMessage,
  UserMemory,
} from "./supabase";
import { CHAT_ATTACHMENT_BUCKET, type ChatAttachment } from "./chat-attachments";

const EMBEDDING_MODEL = "gemini-embedding-001";
const EMBEDDING_DIMENSIONS = 768;
const SEARCH_RESULT_LIMIT = 8;
const MAX_KEYWORD_TERMS = 8;
const SCHEMA_ERROR_CODES = new Set(["PGRST202", "PGRST204", "PGRST205", "42703", "42883", "42P01"]);
type EmbeddingTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

type InsightDraft = Omit<
  MessageInsight,
  "id" | "user_id" | "message_id" | "embedding" | "created_at"
>;

function describeDatabaseError(error: { code?: string; message: string }): string {
  const schemaError =
    (error.code && SCHEMA_ERROR_CODES.has(error.code)) ||
    /schema cache|could not find the function|relation .+ does not exist|column .+ does not exist/i.test(
      error.message,
    );
  return schemaError
    ? `${error.message} Confirm the latest supabase/schema.sql has been run.`
    : error.message;
}

const retrievalStopWords = new Set([
  "ada", "aja", "atau", "belum", "bisa", "buat", "dalam", "dan", "dari", "dengan", "dia",
  "dimana", "guna", "ini", "itu", "juga", "kamu", "karena", "ke", "kenapa", "ketika",
  "kok", "lagi", "lebih", "mau", "mereka", "oleh", "pada", "saja", "sama", "saya",
  "sebagai", "seperti", "sudah", "susah", "tapi", "telah", "tentang", "terus", "tidak",
  "untuk", "yang", "about", "after", "again", "also", "been", "being", "could", "from",
  "have", "into", "just", "more", "most", "only", "other", "over", "same", "some",
  "such", "than", "that", "them", "then", "there", "these", "they", "this", "what",
  "when", "where", "which", "while", "with", "would", "your",
  "di", "ga", "gak", "nya", "yg", "ya", "an", "as", "at", "be", "by", "do", "for",
  "if", "in", "is", "it", "no", "of", "on", "or", "so", "to", "up", "we", "he",
  "she", "my", "me",
]);

function retrievalKeywords(text: string): string[] {
  const frequencies = new Map<string, number>();
  for (const match of text.toLocaleLowerCase().matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]{1,}/gu)) {
    const term = match[0].replace(/['’-]/g, "");
    if (term.length < 2 || retrievalStopWords.has(term)) continue;
    frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
  }
  return [...frequencies]
    .sort(
      ([firstTerm, firstCount], [secondTerm, secondCount]) =>
        secondCount - firstCount ||
        secondTerm.length - firstTerm.length ||
        firstTerm.localeCompare(secondTerm),
    )
    .slice(0, MAX_KEYWORD_TERMS)
    .map(([term]) => term);
}

export type RetrievedChatMessage = Pick<
  StoredChatMessage,
  "id" | "role" | "content" | "created_at"
> & { similarity: number };

export type RetrievedMemory = Pick<UserMemory, "id" | "category" | "content"> & {
  similarity: number;
};

export type RetrievedInsight = Pick<
  MessageInsight,
  | "message_id"
  | "mood"
  | "communication_style"
  | "situation"
  | "topics"
  | "support_needs"
  | "summary"
  | "created_at"
> & { similarity: number };

export async function createEmbedding(
  apiKey: string,
  text: string,
  taskType: EmbeddingTaskType,
): Promise<number[]> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        model: `models/${EMBEDDING_MODEL}`,
        content: { parts: [{ text }] },
        taskType,
        outputDimensionality: EMBEDDING_DIMENSIONS,
      }),
    },
  );
  const payload: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "object" &&
      payload.error !== null &&
      "message" in payload.error &&
      typeof payload.error.message === "string"
        ? payload.error.message
        : `Gemini embeddings returned HTTP ${response.status}.`;
    throw new Error(message);
  }

  const values =
    typeof payload === "object" &&
    payload !== null &&
    "embedding" in payload &&
    typeof payload.embedding === "object" &&
    payload.embedding !== null &&
    "values" in payload.embedding &&
    Array.isArray(payload.embedding.values)
      ? payload.embedding.values
      : null;
  if (
    !values ||
    values.length !== EMBEDDING_DIMENSIONS ||
    values.some((value) => typeof value !== "number" || !Number.isFinite(value))
  ) {
    throw new Error("Gemini returned an invalid message embedding.");
  }

  return values;
}

function serializeEmbedding(values: number[]): string {
  return `[${values.join(",")}]`;
}

export async function saveUserMemory(
  client: AppSupabaseClient,
  apiKey: string,
  content: string,
  category = "general",
  userId?: string,
  sourceMessageId?: string,
): Promise<UserMemory> {
  const normalizedContent = requiredString(content, "memory content", 10000);
  const normalizedCategory = category.trim().slice(0, 80) || "general";
  const embedding = serializeEmbedding(
    await createEmbedding(apiKey, normalizedContent, "RETRIEVAL_DOCUMENT"),
  );

  if (userId) {
    const { data: matches, error: searchError } = await client.rpc(
      "match_user_memories_for_user",
      {
        p_user_id: userId,
        query_embedding: embedding,
        result_limit: 1,
      },
    );
    if (searchError) throw new Error(`Could not check for an existing memory: ${searchError.message}`);
    const duplicate = matches[0];
    if (duplicate && duplicate.similarity >= 0.94) {
      const { data, error } = await client
        .from("user_memories")
        .update({
          content: normalizedContent,
          category: normalizedCategory,
          ...(sourceMessageId ? { source_message_id: sourceMessageId } : {}),
          embedding,
          updated_at: new Date().toISOString(),
        })
        .eq("id", duplicate.id)
        .eq("user_id", userId)
        .select("*")
        .single();
      if (error) throw new Error(`Could not update the existing memory: ${error.message}`);
      return data;
    }
  }

  const { data, error } = await client
    .from("user_memories")
    .insert({
      ...(userId ? { user_id: userId } : {}),
      ...(sourceMessageId ? { source_message_id: sourceMessageId } : {}),
      content: normalizedContent,
      category: normalizedCategory,
      embedding,
    })
    .select("*")
    .single();
  if (error) throw new Error(`Could not create memory: ${error.message}`);
  return data;
}

export async function saveChatMessage(
  client: AppSupabaseClient,
  role: StoredChatMessage["role"],
  content: string,
  embedding: number[] | null,
  thinkingSummary: string | null = null,
  userId?: string,
): Promise<StoredChatMessage> {
  const { data, error } = await client
    .from("chat_messages")
    .insert({
      ...(userId ? { user_id: userId } : {}),
      role,
      content,
      embedding: embedding ? serializeEmbedding(embedding) : null,
      thinking_summary: thinkingSummary,
      revision_reason: "initial",
    })
    .select("id, user_id, role, content, embedding, created_at, version_number, thinking_summary, is_reminder, is_active, revision_reason, admin_message_id")
    .single();
  if (error) {
    throw new Error(
      `Could not save the ${role} message: ${error.message} Confirm the latest supabase/schema.sql has been run.`,
    );
  }
  return data;
}

export async function createChatJob(
  client: AppSupabaseClient,
  content: string,
  thinkingMode: boolean,
): Promise<{ jobId: string; messageId: string }> {
  const { data, error } = await client.rpc("create_chat_job", {
    p_content: content,
    p_thinking_mode: thinkingMode,
  });
  if (error) {
    throw new Error(`Could not queue your message: ${error.message}`);
  }
  const job = data[0];
  if (!job) throw new Error("The chat server did not return a job ID.");
  return { jobId: job.job_id, messageId: job.message_id };
}

export interface ChatMessagePage {
  messages: StoredChatMessage[];
  hasMore: boolean;
}

function isTransientConnectionError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const details = error as { code?: unknown; message?: unknown; cause?: unknown };
  const cause =
    typeof details.cause === "object" && details.cause !== null
      ? (details.cause as { code?: unknown; message?: unknown })
      : null;
  const message = [
    details.message,
    details.code,
    cause?.message,
    cause?.code,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  return /ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|fetch failed|networkerror|network request failed|socket hang up/i.test(
    message,
  );
}

export async function loadChatMessagePage(
  client: AppSupabaseClient,
  options: {
    limit?: number;
    before?: Pick<StoredChatMessage, "id" | "created_at">;
    userId?: string;
  } = {},
): Promise<ChatMessagePage> {
  const { limit = 50, before, userId } = options;
  let data: StoredChatMessage[] | null = null;
  let error: { message: string } | null = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      let query = client
        .from("chat_messages")
        .select("id, user_id, role, content, embedding, created_at, version_number, thinking_summary, is_reminder, is_active, revision_reason, admin_message_id")
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit + 1);
      if (before) {
        query = query.or(
          `created_at.lt.${before.created_at},and(created_at.eq.${before.created_at},id.lt.${before.id})`,
        );
      }
      if (userId) query = query.eq("user_id", userId);
      const result = await query;
      data = result.data;
      error = result.error;
    } catch (requestError) {
      if (!isTransientConnectionError(requestError) || attempt === 2) throw requestError;
      error = {
        message:
          requestError instanceof Error
            ? requestError.message
            : "The database connection was interrupted.",
      };
    }

    if (!error) break;
    if (!isTransientConnectionError(error) || attempt === 2) {
      throw new Error(
        `Could not load saved chat history: ${error.message} Confirm the latest supabase/schema.sql has been run.`,
      );
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 250 * 2 ** attempt));
  }

  if (error || !data) {
    throw new Error(
      `Could not load saved chat history: ${error?.message ?? "The database returned no chat history."} Confirm the latest supabase/schema.sql has been run.`,
    );
  }
  return {
    messages: data.slice(0, limit).reverse(),
    hasMore: data.length > limit,
  };
}

export async function loadMessageAttachments(
  client: AppSupabaseClient,
  messageIds: string[],
): Promise<Record<string, ChatAttachment[]>> {
  if (messageIds.length === 0) return {};
  const [directResult, linkResult] = await Promise.all([
    client
      .from("chat_message_attachments")
      .select("id, user_id, message_id, file_name, mime_type, size_bytes, show_text, created_at, expires_at, deleted_at")
      .in("message_id", messageIds)
      .order("created_at", { ascending: true }),
    client
      .from("chat_message_attachment_links")
      .select("message_id, attachment_id")
      .in("message_id", messageIds),
  ]);
  if (directResult.error || linkResult.error) {
    throw new Error(
      `Could not load chat attachments. Confirm the latest supabase/schema.sql has been run. ${
        directResult.error?.message ?? linkResult.error?.message
      }`,
    );
  }
  const sharedAttachmentIds = [...new Set(linkResult.data.map((link) => link.attachment_id))];
  const sharedResult =
    sharedAttachmentIds.length > 0
      ? await client
          .from("chat_message_attachments")
          .select("id, user_id, message_id, file_name, mime_type, size_bytes, show_text, created_at, expires_at, deleted_at")
          .in("id", sharedAttachmentIds)
      : { data: [], error: null };
  if (sharedResult.error) {
    throw new Error(`Could not load shared chat attachments: ${sharedResult.error.message}`);
  }
  const attachmentsById = new Map(
    [...directResult.data, ...sharedResult.data].map((attachment) => [attachment.id, attachment]),
  );
  const grouped = directResult.data.reduce<Record<string, ChatAttachment[]>>((items, attachment) => {
    if (!attachment.message_id) return items;
    (items[attachment.message_id] ??= []).push(attachment);
    return items;
  }, {});
  for (const link of linkResult.data) {
    const attachment = attachmentsById.get(link.attachment_id);
    if (!attachment) continue;
    const messageAttachments = (grouped[link.message_id] ??= []);
    if (!messageAttachments.some((item) => item.id === attachment.id)) {
      messageAttachments.push(attachment);
    }
  }
  for (const attachments of Object.values(grouped)) {
    attachments.sort((first, second) => first.created_at.localeCompare(second.created_at));
  }
  return grouped;
}

export async function loadMessageCreatedAt(
  client: AppSupabaseClient,
  messageId: string,
): Promise<string> {
  const { data, error } = await client
    .from("chat_messages")
    .select("created_at")
    .eq("id", messageId)
    .single();
  if (error) {
    throw new Error(`Could not load message timestamp: ${error.message}`);
  }
  return data.created_at;
}

export async function loadMessageVersions(
  client: AppSupabaseClient,
  messageIds: string[],
  userId?: string,
): Promise<Record<string, ChatMessageVersion[]>> {
  if (messageIds.length === 0) return {};
  let query = client
    .from("chat_message_versions")
    .select("id, user_id, message_id, version_number, source_message_id, source_message_version_number, content, embedding, thinking_summary, revision_reason, created_at")
    .in("message_id", messageIds)
    .order("version_number", { ascending: true });
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query;
  if (error) {
    throw new Error(`Could not load message versions: ${error.message}`);
  }
  return data.reduce<Record<string, ChatMessageVersion[]>>((versions, item) => {
    (versions[item.message_id] ??= []).push(item);
    return versions;
  }, {});
}

export async function findRelevantContext(
  client: AppSupabaseClient,
  embedding: number[],
  excludeMessageId: string,
  beforeCreatedAt?: string,
  userId?: string,
  keywordText = "",
): Promise<{
  messages: RetrievedChatMessage[];
  memories: RetrievedMemory[];
  insights: RetrievedInsight[];
}> {
  const queryEmbedding = serializeEmbedding(embedding);
  const keywords = retrievalKeywords(keywordText);
  const keywordFilter = keywords
    .map((keyword) => `content.ilike.%${keyword}%`)
    .join(",");
  const [messageResult, memoryResult, keywordMessageResult, keywordMemoryResult, insightResult] =
    await Promise.all([
      userId
        ? beforeCreatedAt
          ? client.rpc("match_chat_messages_before_for_user", {
              p_user_id: userId,
              query_embedding: queryEmbedding,
              max_created_at: beforeCreatedAt,
              result_limit: SEARCH_RESULT_LIMIT,
              exclude_message_id: excludeMessageId,
            })
          : client.rpc("match_chat_messages_for_user", {
              p_user_id: userId,
              query_embedding: queryEmbedding,
              result_limit: SEARCH_RESULT_LIMIT,
              exclude_message_id: excludeMessageId,
            })
        : beforeCreatedAt
        ? client.rpc("match_chat_messages_before", {
            query_embedding: queryEmbedding,
            max_created_at: beforeCreatedAt,
            result_limit: SEARCH_RESULT_LIMIT,
            exclude_message_id: excludeMessageId,
          })
        : client.rpc("match_chat_messages", {
            query_embedding: queryEmbedding,
            result_limit: SEARCH_RESULT_LIMIT,
            exclude_message_id: excludeMessageId,
          }),
      userId
        ? client.rpc("match_user_memories_for_user", {
            p_user_id: userId,
            query_embedding: queryEmbedding,
            result_limit: SEARCH_RESULT_LIMIT,
          })
        : client.rpc("match_user_memories", {
            query_embedding: queryEmbedding,
            result_limit: SEARCH_RESULT_LIMIT,
          }),
      keywords.length > 0
        ? (async () => {
            let query = client
              .from("chat_messages")
              .select("id, role, content, created_at")
              .eq("is_active", true)
              .neq("id", excludeMessageId)
              .or(keywordFilter)
              .order("created_at", { ascending: false })
              .limit(SEARCH_RESULT_LIMIT * 2);
            if (beforeCreatedAt) query = query.lt("created_at", beforeCreatedAt);
            if (userId) query = query.eq("user_id", userId);
            const { data, error } = await query;
            if (error) throw new Error(`Could not search active chat history by keyword: ${error.message}`);
            return data;
          })()
        : Promise.resolve([]),
      keywords.length > 0
        ? (async () => {
            let query = client
              .from("user_memories")
              .select("id, category, content")
              .or(
                [
                  ...keywords.map((keyword) => `content.ilike.%${keyword}%`),
                  ...keywords.map((keyword) => `category.ilike.%${keyword}%`),
                ].join(","),
              )
              .order("updated_at", { ascending: false })
              .limit(SEARCH_RESULT_LIMIT * 2);
            if (userId) query = query.eq("user_id", userId);
            const { data, error } = await query;
            if (error) throw new Error(`Could not search saved memories by keyword: ${error.message}`);
            return data;
          })()
        : Promise.resolve([]),
      userId
        ? client.rpc("match_message_insights_for_user", {
            p_user_id: userId,
            query_embedding: queryEmbedding,
            result_limit: SEARCH_RESULT_LIMIT,
          })
        : Promise.resolve({ data: [], error: null }),
    ]);

  if (messageResult.error) {
    throw new Error(
      `Could not retrieve related chat history: ${describeDatabaseError(messageResult.error)}`,
    );
  }
  if (memoryResult.error) {
    throw new Error(
      `Could not retrieve related memories: ${describeDatabaseError(memoryResult.error)}`,
    );
  }
  if (insightResult.error) {
    throw new Error(
      `Could not retrieve related conversation insights: ${describeDatabaseError(insightResult.error)}`,
    );
  }
  if (keywordMessageResult instanceof Error) throw keywordMessageResult;
  if (keywordMemoryResult instanceof Error) throw keywordMemoryResult;

  const messageMatches = new Map<string, RetrievedChatMessage>();
  for (const row of messageResult.data) {
    if (row.similarity >= 0.35) messageMatches.set(row.id, row);
  }
  for (const row of keywordMessageResult) {
    const matchedTerms = keywords.filter((keyword) =>
      row.content.toLocaleLowerCase().includes(keyword),
    ).length;
    if (!matchedTerms) continue;
    const keywordScore = 0.52 + (matchedTerms / keywords.length) * 0.43;
    const existing = messageMatches.get(row.id);
    if (!existing || existing.similarity < keywordScore) {
      messageMatches.set(row.id, { ...row, similarity: keywordScore });
    }
  }

  const memoryMatches = new Map<string, RetrievedMemory>();
  for (const row of memoryResult.data) {
    if (row.similarity >= 0.35) memoryMatches.set(row.id, row);
  }
  for (const row of keywordMemoryResult) {
    const searchableText = `${row.category} ${row.content}`.toLocaleLowerCase();
    const matchedTerms = keywords.filter((keyword) => searchableText.includes(keyword)).length;
    if (!matchedTerms) continue;
    const keywordScore = 0.52 + (matchedTerms / keywords.length) * 0.43;
    const existing = memoryMatches.get(row.id);
    if (!existing || existing.similarity < keywordScore) {
      memoryMatches.set(row.id, { ...row, similarity: keywordScore });
    }
  }

  return {
    messages: [...messageMatches.values()]
      .sort((first, second) => second.similarity - first.similarity)
      .slice(0, SEARCH_RESULT_LIMIT * 2),
    memories: [...memoryMatches.values()]
      .sort((first, second) => second.similarity - first.similarity)
      .slice(0, SEARCH_RESULT_LIMIT * 2),
    insights: insightResult.data
      .filter((row) => row.similarity >= 0.35)
      .sort((first, second) => second.similarity - first.similarity)
      .slice(0, SEARCH_RESULT_LIMIT),
  };
}

export async function loadRecentInsights(
  client: AppSupabaseClient,
  limit = 12,
  excludeMessageId?: string,
  beforeCreatedAt?: string,
  userId?: string,
): Promise<
  Array<
    Pick<
      MessageInsight,
      "mood" | "communication_style" | "situation" | "topics" | "support_needs" | "summary" | "created_at"
    >
  >
> {
  let messageQuery = client
    .from("chat_messages")
    .select("id")
    .eq("is_active", true)
    .lt("created_at", beforeCreatedAt ?? new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(200);
  if (userId) messageQuery = messageQuery.eq("user_id", userId);
  const { data: activeMessages, error: messageError } = await messageQuery;
  if (messageError) {
    throw new Error(`Could not load active messages for insight context: ${messageError.message}`);
  }
  const messageIds = activeMessages
    .map((item) => item.id)
    .filter((id) => id !== excludeMessageId);
  if (messageIds.length === 0) return [];

  let query = client
    .from("message_insights")
    .select("mood, communication_style, situation, topics, support_needs, summary, created_at")
    .in("message_id", messageIds)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (excludeMessageId) query = query.neq("message_id", excludeMessageId);
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query;
  if (error) {
    throw new Error(
      `Could not load conversation insights: ${error.message} Confirm the latest supabase/schema.sql has been run.`,
    );
  }
  return data.reverse();
}

export async function loadInsightsForMessages(
  client: AppSupabaseClient,
  messageIds: string[],
  userId?: string,
  limit = 12,
  activeBranchOnly = false,
): Promise<
  Array<
    Pick<
      MessageInsight,
      | "message_id"
      | "mood"
      | "communication_style"
      | "situation"
      | "topics"
      | "support_needs"
      | "summary"
      | "created_at"
    >
  >
> {
  let uniqueMessageIds = [...new Set(messageIds)];
  if (uniqueMessageIds.length === 0) return [];

  if (activeBranchOnly) {
    let activeMessagesQuery = client
      .from("chat_messages")
      .select("id")
      .in("id", uniqueMessageIds)
      .eq("is_active", true);
    if (userId) activeMessagesQuery = activeMessagesQuery.eq("user_id", userId);
    const { data: activeMessages, error: activeMessagesError } = await activeMessagesQuery;
    if (activeMessagesError) {
      throw new Error(`Could not verify active-branch insight messages: ${activeMessagesError.message}`);
    }
    uniqueMessageIds = activeMessages.map((item) => item.id);
    if (uniqueMessageIds.length === 0) return [];
  }

  let query = client
    .from("message_insights")
    .select("message_id, mood, communication_style, situation, topics, support_needs, summary, created_at")
    .in("message_id", uniqueMessageIds)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (userId) query = query.eq("user_id", userId);

  const { data, error } = await query;
  if (error) {
    throw new Error(
      `Could not load relevant conversation insights: ${error.message} Confirm the latest supabase/schema.sql has been run.`,
    );
  }
  return data.sort(
    (first, second) =>
      uniqueMessageIds.indexOf(first.message_id) - uniqueMessageIds.indexOf(second.message_id),
  );
}

export async function saveMessageInsight(
  client: AppSupabaseClient,
  messageId: string,
  insight: InsightDraft,
  userId?: string,
  embedding?: string | null,
): Promise<void> {
  const { error } = await client.from("message_insights").upsert(
    {
      ...(userId ? { user_id: userId } : {}),
      message_id: messageId,
      ...insight,
      ...(embedding === undefined ? {} : { embedding }),
    },
    { onConflict: "message_id" },
  );
  if (error) throw new Error(`Could not save message insight: ${error.message}`);
}

export async function saveAssistantRating(
  client: AppSupabaseClient,
  messageId: string,
  versionNumber: number,
  rating: "like" | "dislike" | null,
): Promise<void> {
  const { error } = await client.rpc("set_message_rating", {
    p_message_id: messageId,
    p_version_number: versionNumber,
    p_rating: rating,
  });
  if (error) throw new Error(`Could not save message feedback: ${error.message}`);
}

export async function saveAssistantReport(
  client: AppSupabaseClient,
  messageId: string,
  versionNumber: number,
  details: string,
): Promise<void> {
  const normalizedDetails = details.trim();
  if (!normalizedDetails || normalizedDetails.length > 2000) {
    throw new Error("Feedback details must contain between 1 and 2000 characters.");
  }
  const { error } = await client.from("message_feedback").insert({
    message_id: messageId,
    version_number: versionNumber,
    kind: "report",
    details: normalizedDetails,
  });
  if (error) throw new Error(`Could not save the response report: ${error.message}`);
}

export async function updateChatMessage(
  client: AppSupabaseClient,
  messageId: string,
  content: string,
  embedding: number[] | null,
  thinkingSummary: string | null,
  revisionReason: "user_edit" | "regenerate" | "ai_update",
  branch = true,
  userId?: string,
  sourceMessage?: { id: string; versionNumber: number },
): Promise<StoredChatMessage | null> {
  const { data, error } = await client.rpc("revise_chat_message", {
    p_message_id: messageId,
    p_content: content,
    p_embedding: embedding ? serializeEmbedding(embedding) : null,
    p_thinking_summary: thinkingSummary,
    p_revision_reason: revisionReason,
    p_branch: branch,
    p_user_id: userId ?? null,
    p_source_message_id: sourceMessage?.id ?? null,
    p_source_message_version_number: sourceMessage?.versionNumber ?? null,
  });
  if (error) {
    const action =
      revisionReason === "user_edit"
        ? "edited message"
        : revisionReason === "regenerate"
          ? "regenerated reply"
          : "updated message";
    throw new Error(
      `Could not save the ${action}: ${error.message} Confirm the latest supabase/schema.sql has been run.`,
    );
  }
  return data[0] ?? null;
}

export async function restoreChatBranch(
  client: AppSupabaseClient,
  anchorMessageId: string,
  anchorVersionNumber: number,
): Promise<StoredChatMessage[]> {
  const { data, error } = await client.rpc("restore_chat_branch", {
    p_anchor_message_id: anchorMessageId,
    p_anchor_version_number: anchorVersionNumber,
  });
  if (error) {
    throw new Error(`Could not restore this conversation branch: ${error.message}`);
  }
  return data;
}

export async function saveChatBranch(
  client: AppSupabaseClient,
  anchorMessageId: string,
  anchorVersionNumber: number,
  userId?: string,
  messageVersionOverrides: Record<string, number> = {},
): Promise<void> {
  let ownerId = userId;
  if (!ownerId) {
    const { data, error } = await client.auth.getUser();
    if (error) throw new Error(`Could not identify the account for this branch: ${error.message}`);
    if (!data.user) throw new Error("Sign in before saving a conversation branch.");
    ownerId = data.user.id;
  }

  const { data: activeMessages, error: messagesError } = await client
    .from("chat_messages")
    .select("id, version_number")
    .eq("user_id", ownerId)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (messagesError) {
    throw new Error(`Could not load active messages for this branch: ${messagesError.message}`);
  }
  const activeAnchor = activeMessages.find((message) => message.id === anchorMessageId);
  if (!activeAnchor) throw new Error("The branch anchor message is not active.");
  if (activeAnchor.version_number !== anchorVersionNumber) {
    throw new Error("The branch anchor version is no longer active.");
  }
  if (
    Object.keys(messageVersionOverrides).some(
      (messageId) => !activeMessages.some((message) => message.id === messageId),
    )
  ) {
    throw new Error("A requested message version is not active on this branch.");
  }

  const activeIds = activeMessages.map((message) => message.id);
  const { data: versions, error: versionsError } = await client
    .from("chat_message_versions")
    .select("message_id")
    .eq("user_id", ownerId)
    .in("message_id", activeIds);
  if (versionsError) {
    throw new Error(`Could not load message versions for this branch: ${versionsError.message}`);
  }
  const versionCounts = new Map<string, number>();
  for (const version of versions) {
    versionCounts.set(version.message_id, (versionCounts.get(version.message_id) ?? 0) + 1);
  }

  const branchMessages = activeMessages.map((message) => ({
    message_id: message.id,
    version_number: messageVersionOverrides[message.id] ?? message.version_number,
  }));
  const snapshots = activeMessages
    .filter((message) => message.id === anchorMessageId || (versionCounts.get(message.id) ?? 0) > 1)
    .map((message) => ({
      user_id: ownerId,
      anchor_message_id: message.id,
      anchor_version_number: message.version_number,
      messages: branchMessages,
    }));
  const { error } = await client
    .from("chat_conversation_branches")
    .upsert(snapshots, { onConflict: "user_id,anchor_message_id,anchor_version_number" });
  if (error) throw new Error(`Could not save this conversation branch: ${error.message}`);
}

export async function loadMessageFeedback(
  client: AppSupabaseClient,
  messageId: string,
  versionNumber: number,
  userId?: string,
): Promise<{ rating: "like" | "dislike" | null; reports: string[] }> {
  let query = client
    .from("message_feedback")
    .select("kind, details")
    .eq("message_id", messageId)
    .eq("version_number", versionNumber)
    .order("created_at", { ascending: true });
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load message feedback: ${error.message}`);
  const rating = data.find((item) => item.kind === "like" || item.kind === "dislike")?.kind;
  return {
    rating: rating === "like" || rating === "dislike" ? rating : null,
    reports: data.flatMap((item) =>
      item.kind === "report" && item.details ? [item.details] : [],
    ),
  };
}

export async function loadAllAssistantFeedback(
  client: AppSupabaseClient,
  userId: string,
): Promise<
  Array<{
    feedbackId: string;
    messageId: string;
    rating: "like" | "dislike" | "report";
    response: string;
    versionNumber: number;
    details: string | null;
    request: string | null;
    requestMessageId: string | null;
    createdAt: string;
  }>
> {
  const feedback: Array<{
    id: string;
    message_id: string;
    version_number: number;
    kind: "like" | "dislike" | "report";
    details: string | null;
    created_at: string;
  }> = [];
  const feedbackPageSize = 500;
  for (let offset = 0; ; offset += feedbackPageSize) {
    const { data, error } = await client
      .from("message_feedback")
      .select("id, message_id, version_number, kind, details, created_at")
      .eq("user_id", userId)
      .in("kind", ["like", "dislike", "report"])
      .order("created_at", { ascending: false })
      .range(offset, offset + feedbackPageSize - 1);
    if (error) {
      throw new Error(`Could not load saved response feedback: ${error.message}`);
    }
    if (!data) throw new Error("Could not load saved response feedback: the database returned no data.");
    feedback.push(...data);
    if (data.length < feedbackPageSize) break;
  }
  if (feedback.length === 0) return [];
  const messageIds = [...new Set(feedback.map((item) => item.message_id))];
  const idChunks = Array.from(
    { length: Math.ceil(messageIds.length / 100) },
    (_, index) => messageIds.slice(index * 100, (index + 1) * 100),
  );
  const [versionsResults, targetMessagesResults] = await Promise.all([
    Promise.all(
      idChunks.map((ids) =>
        client
          .from("chat_message_versions")
          .select("message_id, version_number, content")
          .eq("user_id", userId)
          .in("message_id", ids),
      ),
    ),
    Promise.all(
      idChunks.map((ids) =>
        client
          .from("chat_messages")
          .select("id, role, created_at")
          .eq("user_id", userId)
          .in("id", ids),
      ),
    ),
  ]);
  const versionsError = versionsResults.find((result) => result.error)?.error;
  if (versionsError) {
    throw new Error(`Could not load rated response versions: ${versionsError.message}`);
  }
  if (versionsResults.some((result) => result.data === null)) {
    throw new Error("Could not load rated response versions: the database returned no data.");
  }
  const versions = versionsResults.flatMap((result) => result.data ?? []);
  const contentById = new Map(
    versions.map((item) => [`${item.message_id}:${item.version_number}`, item.content]),
  );
  const targetMessagesError = targetMessagesResults.find((result) => result.error)?.error;
  if (targetMessagesError) {
    throw new Error(`Could not load rated response context: ${targetMessagesError.message}`);
  }
  if (targetMessagesResults.some((result) => result.data === null)) {
    throw new Error("Could not load rated response context: the database returned no data.");
  }
  const targetMessages = targetMessagesResults
    .flatMap((result) => result.data ?? [])
    .sort((first, second) => second.created_at.localeCompare(first.created_at))
    .filter((item) => item.role === "assistant");
  const latestResponseTime = targetMessages.reduce(
    (latest, item) => (item.created_at > latest ? item.created_at : latest),
    "",
  );
  const requestByResponseId = new Map<
    string,
    { id: string; content: string; created_at: string } | null
  >();
  let responseIndex = 0;
  const requestPageSize = 500;
  for (let offset = 0; responseIndex < targetMessages.length; offset += requestPageSize) {
    let query = client
      .from("chat_messages")
      .select("id, content, created_at")
      .eq("user_id", userId)
      .eq("role", "user")
      .order("created_at", { ascending: false })
      .range(offset, offset + requestPageSize - 1);
    if (latestResponseTime) query = query.lte("created_at", latestResponseTime);
    const { data, error } = await query;
    if (error) {
      throw new Error(`Could not load requests for rated responses: ${error.message}`);
    }
    if (!data) {
      throw new Error("Could not load requests for rated responses: the database returned no data.");
    }
    let requestIndex = 0;
    while (responseIndex < targetMessages.length) {
      const response = targetMessages[responseIndex];
      while (
        requestIndex < data.length &&
        data[requestIndex].created_at > response.created_at
      ) {
        requestIndex += 1;
      }
      if (requestIndex === data.length) break;
      requestByResponseId.set(response.id, data[requestIndex]);
      responseIndex += 1;
    }
    if (data.length < requestPageSize) break;
  }
  return feedback.flatMap((item) => {
    const content = contentById.get(`${item.message_id}:${item.version_number}`);
    if (!content || !targetMessages.some((message) => message.id === item.message_id)) {
      return [];
    }
    return [{
      feedbackId: item.id,
      messageId: item.message_id,
      rating: item.kind,
      response: content,
      versionNumber: item.version_number,
      details: item.kind === "report" ? item.details : null,
      request: requestByResponseId.get(item.message_id)?.content ?? null,
      requestMessageId: requestByResponseId.get(item.message_id)?.id ?? null,
      createdAt: item.created_at,
    }];
  });
}
function requiredString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`The database action requires a non-empty ${field}.`);
  }
  const result = value.trim();
  if (result.length > maxLength) {
    throw new Error(`${field} must be ${maxLength} characters or fewer.`);
  }
  return result;
}

function requiredId(value: unknown, field: string): string {
  const id = requiredString(value, field, 36);
  if (!/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(id)) {
    throw new Error(`${field} must be a valid record ID returned by a search.`);
  }
  return id;
}

function searchPattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, "\\$&")}%`;
}

function keywordSearchConditions(fields: string[], query: string): string {
  const keywords = retrievalKeywords(query);
  return keywords.length
    ? fields.flatMap((field) =>
        keywords.map((keyword) => `${field}.ilike.%${keyword}%`),
      ).join(",")
    : fields.map((field) => `${field}.ilike.${searchPattern(query)}`).join(",");
}

function keywordMatchCount(value: string, query: string): number {
  const searchableText = value.toLocaleLowerCase();
  return retrievalKeywords(query).filter((keyword) => searchableText.includes(keyword)).length;
}

async function searchUserData(
  client: AppSupabaseClient,
  args: Record<string, unknown>,
  userId?: string,
): Promise<unknown> {
  const category = args.category;
  if (
    category !== "all" &&
    category !== "chat" &&
    category !== "memories" &&
    category !== "insights" &&
    category !== "attachments"
  ) {
    throw new Error("Choose all, chat, memories, insights, or attachments as the search category.");
  }
  const query =
    category === "attachments" && (args.query === undefined || args.query === null)
      ? ""
      : requiredString(args.query, "search query", 200);
  const pattern =
    category === "attachments" && (!query || query.toLowerCase() === "all")
      ? "%"
      : searchPattern(query);
  const searches: Array<PromiseLike<unknown>> = [];

  if (category === "all" || category === "chat") {
    let search = client
      .from("chat_messages")
      .select("id, role, content, created_at")
      .eq("is_active", true)
      .or(keywordSearchConditions(["content"], query))
      .order("created_at", { ascending: false })
      .limit(SEARCH_RESULT_LIMIT * 2);
    if (userId) search = search.eq("user_id", userId);
    searches.push(
      search.then(({ data, error }) => {
          if (error) throw new Error(`Could not search chat history: ${error.message}`);
          return {
            category: "chat",
            records: data
              .sort(
                (first, second) =>
                  keywordMatchCount(second.content, query) - keywordMatchCount(first.content, query) ||
                  second.created_at.localeCompare(first.created_at),
              )
              .slice(0, SEARCH_RESULT_LIMIT),
          };
        }),
    );
  }
  if (category === "all" || category === "memories") {
    let search = client
      .from("user_memories")
      .select("id, category, content, updated_at")
      .or(keywordSearchConditions(["content", "category"], query))
      .order("updated_at", { ascending: false })
      .limit(SEARCH_RESULT_LIMIT * 2);
    if (userId) search = search.eq("user_id", userId);
    searches.push(
      search.then(({ data, error }) => {
          if (error) throw new Error(`Could not search memories: ${error.message}`);
          return {
            category: "memories",
            records: data
              .sort(
                (first, second) =>
                  keywordMatchCount(`${second.category} ${second.content}`, query) -
                    keywordMatchCount(`${first.category} ${first.content}`, query) ||
                  second.updated_at.localeCompare(first.updated_at),
              )
              .slice(0, SEARCH_RESULT_LIMIT),
          };
        }),
    );
  }
  if (category === "all" || category === "insights") {
    searches.push((async () => {
      let search = client
        .from("message_insights")
        .select("id, message_id, mood, communication_style, situation, topics, support_needs, summary, created_at")
        .or(
          keywordSearchConditions(
            ["summary", "mood", "communication_style", "situation", "support_needs"],
            query,
          ),
        )
        .order("created_at", { ascending: false })
        .limit(SEARCH_RESULT_LIMIT * 4);
      if (userId) search = search.eq("user_id", userId);
      const { data: candidateInsights, error } = await search;
      if (error) throw new Error(`Could not search insights: ${error.message}`);
      if (candidateInsights.length === 0) {
        return { category: "insights", records: [] };
      }
      let activeMessagesQuery = client
        .from("chat_messages")
        .select("id")
        .in("id", [...new Set(candidateInsights.map((insight) => insight.message_id))])
        .eq("is_active", true);
      if (userId) activeMessagesQuery = activeMessagesQuery.eq("user_id", userId);
      const { data: activeMessages, error: activeMessagesError } = await activeMessagesQuery;
      if (activeMessagesError) {
        throw new Error(`Could not verify active-branch insights: ${activeMessagesError.message}`);
      }
      const activeMessageIds = new Set(activeMessages.map((message) => message.id));
      return {
        category: "insights",
        records: candidateInsights
          .filter((insight) => activeMessageIds.has(insight.message_id))
          .sort(
            (first, second) =>
              keywordMatchCount(
                `${second.summary} ${second.mood} ${second.communication_style} ${second.situation} ${second.support_needs}`,
                query,
              ) -
                keywordMatchCount(
                  `${first.summary} ${first.mood} ${first.communication_style} ${first.situation} ${first.support_needs}`,
                  query,
                ) ||
              second.created_at.localeCompare(first.created_at),
          )
          .slice(0, SEARCH_RESULT_LIMIT),
      };
    })());
  }
  if (category === "all" || category === "attachments") {
    let search = client
      .from("chat_message_attachments")
      .select("id, message_id, file_name, mime_type, size_bytes, created_at, expires_at")
      .ilike("file_name", pattern)
      .is("deleted_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(SEARCH_RESULT_LIMIT);
    if (userId) search = search.eq("user_id", userId);
    searches.push(
      search.then(({ data, error }) => {
        if (error) throw new Error(`Could not search uploaded attachments: ${error.message}`);
        return { category: "attachments", records: data };
      }),
    );
  }
  return Promise.all(searches);
}

async function deleteChatAttachment(
  client: AppSupabaseClient,
  id: string,
  confirmDelete: (label: string, preview: string) => boolean | Promise<boolean>,
  userId?: string,
  deleteAttachment?: (id: string) => Promise<unknown>,
): Promise<unknown> {
  let query = client
    .from("chat_message_attachments")
    .select("id, user_id, message_id, storage_path, file_name, deleted_at")
    .eq("id", id)
    .is("deleted_at", null);
  if (userId) query = query.eq("user_id", userId);
  const { data: attachment, error: lookupError } = await query.maybeSingle();
  if (lookupError) throw new Error(`Could not load the attachment to delete: ${lookupError.message}`);
  if (!attachment) {
    throw new Error("That attachment is no longer available or does not belong to this account.");
  }

  const label = `uploaded attachment "${attachment.file_name}"`;
  const preview = `This permanently removes "${attachment.file_name}" from private file storage. Its message and chat history will remain.`;
  if (!(await confirmDelete(label, preview))) {
    return { deleted: false, cancelled: true, fileName: attachment.file_name };
  }

  if (deleteAttachment) {
    await deleteAttachment(attachment.id);
  } else if (userId) {
    await releaseStoredChatAttachment(client, attachment.id, userId);
  } else {
    throw new Error("Could not securely determine the owner of this attachment.");
  }
  return { deleted: true, fileName: attachment.file_name };
}

export async function releaseStoredChatAttachment(
  client: AppSupabaseClient,
  attachmentId: string,
  userId: string,
  expiredOnly = false,
): Promise<{ deleted: boolean; removedStorageObject: boolean }> {
  const { data, error } = await client.rpc("release_chat_attachment_reference", {
    p_attachment_id: attachmentId,
    p_user_id: userId,
    p_expired_only: expiredOnly,
  });
  if (error) throw new Error(`Could not release attachment reference: ${error.message}`);
  const released = data[0];
  if (!released) throw new Error("Attachment reference was not found.");
  if (!released.should_delete || !released.storage_path) {
    return { deleted: true, removedStorageObject: false };
  }

  const { error: storageError } = await client.storage
    .from(CHAT_ATTACHMENT_BUCKET)
    .remove([released.storage_path]);
  if (storageError) {
    throw new Error(`Could not remove attachment from private storage: ${storageError.message}`);
  }
  const { data: purged, error: purgeError } = await client.rpc(
    "purge_released_chat_attachment_references",
    { p_user_id: userId, p_storage_path: released.storage_path },
  );
  if (purgeError) throw new Error(`Could not remove attachment metadata: ${purgeError.message}`);
  if (!purged) throw new Error("Attachment references changed while deleting the stored file.");
  return { deleted: true, removedStorageObject: true };
}

async function deduplicateUserMemories(
  client: AppSupabaseClient,
  confirmDelete: (label: string, preview: string) => boolean | Promise<boolean>,
  userId?: string,
): Promise<unknown> {
  const pageSize = 500;
  const memories: Array<{
    id: string;
    category: string;
    content: string;
    updated_at: string;
  }> = [];

  for (let offset = 0; ; offset += pageSize) {
    let query = client
      .from("user_memories")
      .select("id, category, content, updated_at")
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (userId) query = query.eq("user_id", userId);
    const { data, error } = await query;
    if (error) throw new Error(`Could not load memories for duplicate check: ${error.message}`);
    memories.push(...data);
    if (data.length < pageSize) break;
  }

  const groups = new Map<string, typeof memories>();
  for (const memory of memories) {
    const normalized = memory.content.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
    if (!normalized) continue;
    const matching = groups.get(normalized) ?? [];
    matching.push(memory);
    groups.set(normalized, matching);
  }
  const duplicateGroups = [...groups.values()].filter((group) => group.length > 1);
  const duplicateIds = duplicateGroups.flatMap((group) => group.slice(1).map((memory) => memory.id));
  if (duplicateIds.length === 0) {
    return { duplicateGroups: 0, deletedCount: 0, message: "No exact duplicate memories found." };
  }

  const preview = duplicateGroups
    .slice(0, 10)
    .map((group) => `Keep "${group[0].content.slice(0, 180)}"; remove ${group.length - 1} duplicate(s).`)
    .join("\n");
  if (!(await confirmDelete("duplicate saved memories", preview))) {
    return { duplicateGroups: duplicateGroups.length, deletedCount: 0, cancelled: true };
  }

  let deletedCount = 0;
  for (let offset = 0; offset < duplicateIds.length; offset += 100) {
    const batch = duplicateIds.slice(offset, offset + 100);
    let remove = client.from("user_memories").delete().in("id", batch);
    if (userId) remove = remove.eq("user_id", userId);
    const { data, error } = await remove.select("id");
    if (error) throw new Error(`Could not remove duplicate memories: ${error.message}`);
    deletedCount += data.length;
  }

  return {
    duplicateGroups: duplicateGroups.length,
    deletedCount,
    keptMostRecentlyUpdated: true,
  };
}

export async function executeChatDataTool(
  client: AppSupabaseClient,
  apiKey: string,
  name: string,
  input: unknown,
  confirmDelete: (label: string, preview: string) => boolean | Promise<boolean>,
  userId?: string,
  sourceMessageId?: string,
  deleteAttachment?: (id: string) => Promise<unknown>,
): Promise<unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("The AI provided invalid database tool input.");
  }
  const args = input as Record<string, unknown>;

  if (name === "search_user_data") return searchUserData(client, args, userId);
  if (name === "delete_chat_attachment") {
    return deleteChatAttachment(
      client,
      requiredId(args.id, "attachment ID"),
      confirmDelete,
      userId,
      deleteAttachment,
    );
  }
  if (name === "deduplicate_memories") {
    return deduplicateUserMemories(client, confirmDelete, userId);
  }

  if (name === "create_memory") {
    const category =
      typeof args.category === "string" ? args.category.trim().slice(0, 80) : "general";
    return saveUserMemory(
      client,
      apiKey,
      requiredString(args.content, "memory content", 10000),
      category,
      userId,
      sourceMessageId,
    );
  }

  if (name === "update_memory") {
    const id = requiredId(args.id, "memory ID");
    const updates: { content?: string; category?: string; embedding?: string } = {};
    if ("content" in args) {
      updates.content = requiredString(args.content, "memory content", 10000);
      updates.embedding = serializeEmbedding(
        await createEmbedding(apiKey, updates.content, "RETRIEVAL_DOCUMENT"),
      );
    }
    if ("category" in args) {
      updates.category = requiredString(args.category, "memory category", 80);
    }
    if (Object.keys(updates).length === 0) throw new Error("Provide new memory content or category.");
    let update = client
      .from("user_memories")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (userId) update = update.eq("user_id", userId);
    const { data, error } = await update
      .select("id, category, content, updated_at")
      .maybeSingle();
    if (error) throw new Error(`Could not update memory: ${error.message}`);
    if (!data) throw new Error("Memory not found in this user's database.");
    return data;
  }

  if (name === "delete_memory") {
    const id = requiredId(args.id, "memory ID");
    let read = client
      .from("user_memories")
      .select("id, category, content")
      .eq("id", id);
    if (userId) read = read.eq("user_id", userId);
    const { data: memory, error: readError } = await read.maybeSingle();
    if (readError) throw new Error(`Could not load memory before deletion: ${readError.message}`);
    if (!memory) throw new Error("Memory not found in this user's database.");
    if (!(await confirmDelete("memory", memory.content))) {
      return { deleted: false, reason: "User cancelled deletion." };
    }
    let remove = client.from("user_memories").delete().eq("id", id);
    if (userId) remove = remove.eq("user_id", userId);
    const { error } = await remove;
    if (error) throw new Error(`Could not delete memory: ${error.message}`);
    return { deleted: true, category: memory.category, content: memory.content };
  }

  if (name === "update_chat_message") {
    const id = requiredId(args.id, "message ID");
    const content = requiredString(args.content, "message content", 50000);
    const embedding = await createEmbedding(apiKey, content, "RETRIEVAL_DOCUMENT");
    const updated = await updateChatMessage(
      client,
      id,
      content,
      embedding,
      null,
      "ai_update",
      false,
      userId,
    );
    if (!updated) throw new Error("Chat message not found in this user's database.");
    return {
      id: updated.id,
      role: updated.role,
      content: updated.content,
      created_at: updated.created_at,
    };
  }

  if (name === "delete_chat_message") {
    const id = requiredId(args.id, "message ID");
    let read = client
      .from("chat_messages")
      .select("id, role, content")
      .eq("id", id);
    if (userId) read = read.eq("user_id", userId);
    const { data: message, error: readError } = await read.maybeSingle();
    if (readError) throw new Error(`Could not load chat message before deletion: ${readError.message}`);
    if (!message) throw new Error("Chat message not found in this user's database.");
    if (!(await confirmDelete("chat message", message.content))) {
      return { deleted: false, reason: "User cancelled deletion." };
    }
    let remove = client.from("chat_messages").delete().eq("id", id);
    if (userId) remove = remove.eq("user_id", userId);
    const { error } = await remove;
    if (error) throw new Error(`Could not delete chat message: ${error.message}`);
    return { deleted: true, role: message.role, content: message.content };
  }

  if (name === "update_message_insight") {
    const id = requiredId(args.id, "insight ID");
    const updates: Partial<InsightDraft> = {};
    for (const field of ["mood", "communication_style", "situation", "support_needs", "summary"] as const) {
      if (field in args) {
        if (typeof args[field] !== "string" || args[field].length > 2000) {
          throw new Error(`${field} must be text containing at most 2,000 characters.`);
        }
        updates[field] = args[field].trim();
      }
    }
    if ("topics" in args) {
      if (
        !Array.isArray(args.topics) ||
        args.topics.length > 20 ||
        args.topics.some((topic) => typeof topic !== "string" || topic.length > 100)
      ) {
        throw new Error("Insight topics must be a list of text values.");
      }
      updates.topics = args.topics.map((topic) => topic.trim()).filter(Boolean);
    }
    if (Object.keys(updates).length === 0) throw new Error("Provide at least one insight field to update.");
    let update = client
      .from("message_insights")
      .update(updates)
      .eq("id", id);
    if (userId) update = update.eq("user_id", userId);
    const { data, error } = await update
      .select("id, message_id, mood, communication_style, situation, topics, support_needs, summary, created_at")
      .maybeSingle();
    if (error) throw new Error(`Could not update insight: ${error.message}`);
    if (!data) throw new Error("Insight not found in this user's database.");
    return data;
  }

  if (name === "delete_message_insight") {
    const id = requiredId(args.id, "insight ID");
    let read = client
      .from("message_insights")
      .select("id, summary, mood")
      .eq("id", id);
    if (userId) read = read.eq("user_id", userId);
    const { data: insight, error: readError } = await read.maybeSingle();
    if (readError) throw new Error(`Could not load insight before deletion: ${readError.message}`);
    if (!insight) throw new Error("Insight not found in this user's database.");
    if (!(await confirmDelete("insight", insight.summary || insight.mood))) {
      return { deleted: false, reason: "User cancelled deletion." };
    }
    let remove = client.from("message_insights").delete().eq("id", id);
    if (userId) remove = remove.eq("user_id", userId);
    const { error } = await remove;
    if (error) throw new Error(`Could not delete insight: ${error.message}`);
    return { deleted: true, summary: insight.summary };
  }

  throw new Error(`Unsupported database action: ${name}`);
}
