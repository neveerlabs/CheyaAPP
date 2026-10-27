import type { AppSupabaseClient } from "../../lib/supabase";

export type RetrieveInput = {
  client: AppSupabaseClient;
  userId: string;
  queryEmbedding: number[];
  excludeMessageId: string;
  beforeCreatedAt?: string;
  keywordText?: string;
};

export type RetrievedChunk = {
  kind: "message" | "memory" | "insight";
  id: string;
  content: string;
  role?: string;
  created_at: string;
  similarity: number;
  insight?: {
    mood: string;
    communication_style: string;
    situation: string;
    topics: string[];
    support_needs: string;
    summary: string;
  };
};

const RETRIEVAL_PAGE_SIZE = 100;
const MIN_RETRIEVAL_SIMILARITY = 0.35;

function normalizeKeywordText(value?: string): string {
  return (value ?? "").trim();
}

function extractKeywords(value: string): string[] {
  const stopWords = new Set([
    "ada", "aja", "atau", "belum", "bisa", "buat", "dalam", "dan", "dari", "dengan",
    "dia", "dimana", "guna", "ini", "itu", "juga", "kamu", "karena", "ke", "kenapa",
    "ketika", "kok", "lagi", "lebih", "mau", "mereka", "oleh", "pada", "saja", "sama",
    "saya", "sebagai", "seperti", "sudah", "tapi", "telah", "tentang", "terus", "tidak",
    "untuk", "yang", "about", "after", "again", "also", "been", "being", "could", "from",
    "have", "into", "just", "more", "most", "only", "other", "over", "same", "some",
    "such", "than", "that", "them", "then", "there", "these", "they", "this", "what",
    "when", "where", "which", "while", "with", "would", "your", "di", "ga", "gak", "nya",
    "yg", "ya", "an", "as", "at", "be", "by", "do", "for", "if", "in", "is", "it",
    "no", "of", "on", "or", "so", "to", "up", "we", "he", "she", "my", "me",
  ]);
  const terms = new Set<string>();
  for (const match of value.toLocaleLowerCase().matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]{1,}/gu)) {
    const term = match[0].replace(/['’-]/g, "");
    if (term.length >= 3 && !stopWords.has(term)) terms.add(term);
  }
  return [...terms].slice(0, 8);
}

function buildKeywordOrClause(fields: string[], keywords: string[]): string {
  return fields
    .flatMap((field) => keywords.map((keyword) => `${field}.ilike.%${keyword}%`))
    .join(",");
}

async function fetchSemanticResults(
  client: AppSupabaseClient,
  userId: string,
  queryEmbedding: number[],
  excludeMessageId: string,
  beforeCreatedAt?: string,
): Promise<RetrievedChunk[]> {
  const queryEmbeddingString = `[${queryEmbedding.join(",")}]`;
  const results: RetrievedChunk[] = [];

  for (let resultOffset = 0; ; resultOffset += RETRIEVAL_PAGE_SIZE) {
    const messageResult = beforeCreatedAt
      ? await client.rpc("match_chat_messages_before_for_user", {
          p_user_id: userId,
          query_embedding: queryEmbeddingString,
          max_created_at: beforeCreatedAt,
          result_limit: RETRIEVAL_PAGE_SIZE,
          exclude_message_id: excludeMessageId || null,
          result_offset: resultOffset,
        })
      : await client.rpc("match_chat_messages_for_user", {
          p_user_id: userId,
          query_embedding: queryEmbeddingString,
          result_limit: RETRIEVAL_PAGE_SIZE,
          exclude_message_id: excludeMessageId || null,
          result_offset: resultOffset,
        });
    if (messageResult.error) {
      throw new Error(`Could not retrieve relevant chat context: ${messageResult.error.message}`);
    }
    const rows = messageResult.data ?? [];
    for (const row of rows) {
      const similarity = Number(row.similarity);
      if (similarity < MIN_RETRIEVAL_SIMILARITY) break;
      results.push({
        kind: "message",
        id: row.id,
        content: row.content,
        role: row.role,
        created_at: row.created_at,
        similarity,
      });
    }
    if (
      rows.length < RETRIEVAL_PAGE_SIZE ||
      Number(rows[rows.length - 1]?.similarity ?? 0) < MIN_RETRIEVAL_SIMILARITY
    ) {
      break;
    }
  }

  for (let resultOffset = 0; ; resultOffset += RETRIEVAL_PAGE_SIZE) {
    const memoryResult = await client.rpc("match_user_memories_for_user", {
      p_user_id: userId,
      query_embedding: queryEmbeddingString,
      result_limit: RETRIEVAL_PAGE_SIZE,
      result_offset: resultOffset,
    });
    if (memoryResult.error) {
      throw new Error(`Could not retrieve relevant saved memories: ${memoryResult.error.message}`);
    }
    const rows = memoryResult.data ?? [];
    for (const row of rows) {
      const similarity = Number(row.similarity);
      if (similarity < MIN_RETRIEVAL_SIMILARITY) break;
      results.push({
        kind: "memory",
        id: row.id,
        content: row.content,
        created_at: new Date().toISOString(),
        similarity,
      });
    }
    if (
      rows.length < RETRIEVAL_PAGE_SIZE ||
      Number(rows[rows.length - 1]?.similarity ?? 0) < MIN_RETRIEVAL_SIMILARITY
    ) {
      break;
    }
  }

  for (let resultOffset = 0; ; resultOffset += RETRIEVAL_PAGE_SIZE) {
    const insightResult = await client.rpc("match_message_insights_for_user", {
      p_user_id: userId,
      query_embedding: queryEmbeddingString,
      result_limit: RETRIEVAL_PAGE_SIZE,
      result_offset: resultOffset,
    });
    if (insightResult.error) {
      throw new Error(`Could not retrieve relevant conversation insights: ${insightResult.error.message}`);
    }
    const rows = insightResult.data ?? [];
    for (const row of rows) {
      const similarity = Number(row.similarity);
      if (similarity < MIN_RETRIEVAL_SIMILARITY) break;
      results.push({
        kind: "insight",
        id: row.message_id,
        content: row.summary,
        created_at: row.created_at,
        similarity,
        insight: {
          mood: row.mood,
          communication_style: row.communication_style,
          situation: row.situation,
          topics: row.topics,
          support_needs: row.support_needs,
          summary: row.summary,
        },
      });
    }
    if (
      rows.length < RETRIEVAL_PAGE_SIZE ||
      Number(rows[rows.length - 1]?.similarity ?? 0) < MIN_RETRIEVAL_SIMILARITY
    ) {
      break;
    }
  }

  return results;
}

async function fetchKeywordResults(
  client: AppSupabaseClient,
  userId: string,
  keywordText: string,
  beforeCreatedAt?: string,
  excludeMessageId?: string,
): Promise<{ messages: RetrievedChunk[]; memories: RetrievedChunk[] }> {
  const keywords = extractKeywords(normalizeKeywordText(keywordText));
  if (keywords.length === 0) {
    return { messages: [], memories: [] };
  }

  const scoreForKeywords = (text: string) => {
    const lower = text.toLocaleLowerCase();
    const matchedCount = keywords.filter((keyword) => lower.includes(keyword)).length;
    return matchedCount === 0 ? 0 : 0.35 + 0.3 * (matchedCount / keywords.length);
  };

  const messages: RetrievedChunk[] = [];
  const memoryResults: RetrievedChunk[] = [];
  for (let offset = 0; ; offset += RETRIEVAL_PAGE_SIZE) {
    let query = client
      .from("chat_messages")
      .select("id, role, content, created_at")
      .eq("user_id", userId)
      .eq("is_active", true)
      .or(buildKeywordOrClause(["content"], keywords))
      .order("created_at", { ascending: false })
      .range(offset, offset + RETRIEVAL_PAGE_SIZE - 1);
    if (beforeCreatedAt) query = query.lt("created_at", beforeCreatedAt);
    if (excludeMessageId) query = query.neq("id", excludeMessageId);
    const { data, error } = await query;
    if (error) throw new Error(`Could not load keyword-matched messages: ${error.message}`);
    const rows = data ?? [];
    messages.push(
      ...rows.map((row) => ({
        kind: "message" as const,
        id: row.id,
        content: row.content,
        role: row.role,
        created_at: row.created_at,
        similarity: scoreForKeywords(row.content),
      })),
    );
    if (rows.length < RETRIEVAL_PAGE_SIZE) break;
  }
  for (let offset = 0; ; offset += RETRIEVAL_PAGE_SIZE) {
    const { data, error } = await client
      .from("user_memories")
      .select("id, category, content, updated_at")
      .eq("user_id", userId)
      .or(buildKeywordOrClause(["content", "category"], keywords))
      .order("updated_at", { ascending: false })
      .range(offset, offset + RETRIEVAL_PAGE_SIZE - 1);
    if (error) throw new Error(`Could not load keyword-matched memories: ${error.message}`);
    const rows = data ?? [];
    memoryResults.push(
      ...rows.map((row) => ({
        kind: "memory" as const,
        id: row.id,
        content: row.content,
        created_at: row.updated_at ?? new Date().toISOString(),
        similarity: scoreForKeywords(`${row.category} ${row.content}`),
      })),
    );
    if (rows.length < RETRIEVAL_PAGE_SIZE) break;
  }
  return { messages, memories: memoryResults };
}

export async function retrieveContext(input: RetrieveInput): Promise<RetrievedChunk[]> {
  const { client, userId, queryEmbedding, excludeMessageId, beforeCreatedAt, keywordText } = input;
  const [results, keywordChunks] = await Promise.all([
    fetchSemanticResults(
      client,
      userId,
      queryEmbedding,
      excludeMessageId,
      beforeCreatedAt,
    ),
    fetchKeywordResults(
      client,
      userId,
      keywordText ?? "",
      beforeCreatedAt,
      excludeMessageId,
    ),
  ]);

  results.push(...keywordChunks.messages, ...keywordChunks.memories);
  const uniqueResults = new Map<string, RetrievedChunk>();
  for (const item of results) {
    const key = `${item.kind}:${item.id}`;
    const existing = uniqueResults.get(key);
    if (!existing || item.similarity > existing.similarity) uniqueResults.set(key, item);
  }
  return [...uniqueResults.values()].sort((first, second) => second.similarity - first.similarity);
}
