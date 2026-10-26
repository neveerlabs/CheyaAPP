import type { AppSupabaseClient } from "../../lib/supabase";

export type RetrieveInput = {
  client: AppSupabaseClient;
  userId: string;
  queryEmbedding: number[];
  excludeMessageId: string;
  beforeCreatedAt?: string;
  keywordText?: string;
  mode: "fast" | "thinking";
};

export type RetrievedChunk = {
  kind: "message" | "memory";
  id: string;
  content: string;
  role?: string;
  created_at: string;
  similarity: number;
};

function normalizeKeywordText(value?: string): string {
  return (value ?? "").trim();
}

function trigramKeywordEnabled(): boolean {
  const envValue =
    typeof import.meta !== "undefined" && import.meta && "env" in import.meta
      ? import.meta.env?.VITE_ENABLE_TRIGRAM_KEYWORD_SEARCH
      : undefined;
  if (typeof envValue === "string") return envValue === "true" || envValue === "1";
  if (typeof envValue === "boolean") return envValue;
  return false;
}

function buildKeywordOrClause(fields: string[], rawKeyword: string): string {
  const escaped = rawKeyword.replace(/'/g, "''");
  return fields
    .map((field) => `${field}.ilike.%${escaped}%`)
    .join(",");
}

async function fetchFastResults(
  client: AppSupabaseClient,
  userId: string,
  queryEmbedding: number[],
  excludeMessageId: string,
  beforeCreatedAt?: string,
): Promise<{ messages: RetrievedChunk[]; memories: RetrievedChunk[] }> {
  const queryEmbeddingString = `[${queryEmbedding.join(",")}]`;
  const [messageResult, memoryResult] = await Promise.all([
    beforeCreatedAt
      ? client.rpc("match_chat_messages_before_for_user", {
          p_user_id: userId,
          query_embedding: queryEmbeddingString,
          max_created_at: beforeCreatedAt,
          result_limit: 3,
          exclude_message_id: excludeMessageId || null,
        })
      : client.rpc("match_chat_messages_for_user", {
          p_user_id: userId,
          query_embedding: queryEmbeddingString,
          result_limit: 3,
          exclude_message_id: excludeMessageId || null,
        }),
    client.rpc("match_user_memories_for_user", {
      p_user_id: userId,
      query_embedding: queryEmbeddingString,
      result_limit: 3,
    }),
  ]);

  if (messageResult.error) throw new Error(`Could not retrieve fast chat context: ${messageResult.error.message}`);
  if (memoryResult.error) throw new Error(`Could not retrieve fast memory context: ${memoryResult.error.message}`);

  return {
    messages: (messageResult.data ?? []).filter((row) => row.similarity >= 0.4).map((row) => ({
      kind: "message",
      id: row.id,
      content: row.content,
      role: row.role,
      created_at: row.created_at,
      similarity: Number(row.similarity),
    })),
    memories: (memoryResult.data ?? []).filter((row) => row.similarity >= 0.4).map((row) => ({
      kind: "memory",
      id: row.id,
      content: row.content,
      created_at: new Date().toISOString(),
      similarity: Number(row.similarity),
    })),
  };
}

async function fetchThinkingKeywordResults(
  client: AppSupabaseClient,
  userId: string,
  keywordText: string,
): Promise<{ messages: RetrievedChunk[]; memories: RetrievedChunk[] }> {
  const keyword = normalizeKeywordText(keywordText);
  if (!keyword || keyword.length < 3 || !trigramKeywordEnabled()) {
    return { messages: [], memories: [] };
  }

  const [messageResult, memoryResult] = await Promise.all([
    client
      .from("chat_messages")
      .select("id, role, content, created_at")
      .eq("user_id", userId)
      .eq("is_active", true)
      .or(buildKeywordOrClause(["content"], keyword))
      .order("created_at", { ascending: false })
      .limit(8),
    client
      .from("user_memories")
      .select("id, category, content, updated_at")
      .eq("user_id", userId)
      .or(buildKeywordOrClause(["content", "category"], keyword))
      .order("updated_at", { ascending: false })
      .limit(8),
  ]);

  if (messageResult.error) throw new Error(`Could not load keyword-matched messages: ${messageResult.error.message}`);
  if (memoryResult.error) throw new Error(`Could not load keyword-matched memories: ${memoryResult.error.message}`);

  const scoreForKeyword = (text: string) => {
    const lower = text.toLocaleLowerCase();
    return lower.includes(keyword.toLocaleLowerCase()) ? 0.58 : 0.0;
  };

  return {
    messages: (messageResult.data ?? []).map((row) => ({
      kind: "message",
      id: row.id,
      content: row.content,
      role: row.role,
      created_at: row.created_at,
      similarity: scoreForKeyword(row.content),
    })),
    memories: (memoryResult.data ?? []).map((row) => ({
      kind: "memory",
      id: row.id,
      content: row.content,
      created_at: row.updated_at ?? new Date().toISOString(),
      similarity: scoreForKeyword(`${row.category} ${row.content}`),
    })),
  };
}

export async function retrieveContext(input: RetrieveInput): Promise<RetrievedChunk[]> {
  const { client, userId, queryEmbedding, excludeMessageId, beforeCreatedAt, keywordText, mode } = input;
  const normalizedMode = mode === "thinking" ? "thinking" : "fast";
  const keyword = normalizeKeywordText(keywordText);

  if (normalizedMode === "fast") {
    const results = await fetchFastResults(
      client,
      userId,
      queryEmbedding,
      excludeMessageId,
      beforeCreatedAt,
    );
    return [...results.messages, ...results.memories]
      .sort((first, second) => second.similarity - first.similarity)
      .slice(0, 3);
  }

  const [messageResult, memoryResult] = await Promise.all([
    beforeCreatedAt
      ? client.rpc("match_chat_messages_before_for_user", {
          p_user_id: userId,
          query_embedding: `[${queryEmbedding.join(",")}]`,
          max_created_at: beforeCreatedAt,
          result_limit: 8,
          exclude_message_id: excludeMessageId || null,
        })
      : client.rpc("match_chat_messages_for_user", {
          p_user_id: userId,
          query_embedding: `[${queryEmbedding.join(",")}]`,
          result_limit: 8,
          exclude_message_id: excludeMessageId || null,
        }),
    client.rpc("match_user_memories_for_user", {
      p_user_id: userId,
      query_embedding: `[${queryEmbedding.join(",")}]`,
      result_limit: 8,
    }),
  ]);

  if (messageResult.error) throw new Error(`Could not retrieve thinking chat context: ${messageResult.error.message}`);
  if (memoryResult.error) throw new Error(`Could not retrieve thinking memory context: ${memoryResult.error.message}`);

  const messageChunks = (messageResult.data ?? [])
    .filter((row) => row.similarity >= 0.35)
    .map((row) => ({
      kind: "message" as const,
      id: row.id,
      content: row.content,
      role: row.role,
      created_at: row.created_at,
      similarity: Number(row.similarity),
    }));

  const memoryChunks = (memoryResult.data ?? [])
    .filter((row) => row.similarity >= 0.35)
    .map((row) => ({
      kind: "memory" as const,
      id: row.id,
      content: row.content,
      created_at: new Date().toISOString(),
      similarity: Number(row.similarity),
    }));

  const keywordChunks = keyword.length >= 3 && trigramKeywordEnabled()
    ? await fetchThinkingKeywordResults(client, userId, keyword)
    : { messages: [], memories: [] };

  return [...messageChunks, ...memoryChunks, ...keywordChunks.messages, ...keywordChunks.memories]
    .sort((first, second) => second.similarity - first.similarity)
    .slice(0, 8);
}
