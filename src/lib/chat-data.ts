import type {
  AppSupabaseClient,
  MessageInsight,
  StoredChatMessage,
  UserMemory,
} from "./supabase";

const EMBEDDING_MODEL = "gemini-embedding-001";
const EMBEDDING_DIMENSIONS = 768;
const SEARCH_RESULT_LIMIT = 8;
type EmbeddingTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

type InsightDraft = Omit<MessageInsight, "id" | "user_id" | "message_id" | "created_at">;

export type RetrievedChatMessage = Pick<
  StoredChatMessage,
  "id" | "role" | "content" | "created_at"
> & { similarity: number };

export type RetrievedMemory = Pick<UserMemory, "id" | "category" | "content"> & {
  similarity: number;
};

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

export async function saveChatMessage(
  client: AppSupabaseClient,
  role: StoredChatMessage["role"],
  content: string,
  embedding: number[] | null,
): Promise<StoredChatMessage> {
  const { data, error } = await client
    .from("chat_messages")
    .insert({ role, content, embedding: embedding ? serializeEmbedding(embedding) : null })
    .select("id, user_id, role, content, created_at")
    .single();
  if (error) {
    throw new Error(
      `Could not save the ${role} message: ${error.message} Confirm the latest supabase/schema.sql has been run.`,
    );
  }
  return data;
}

export async function loadRecentChatMessages(
  client: AppSupabaseClient,
  limit = 50,
): Promise<StoredChatMessage[]> {
  const { data, error } = await client
    .from("chat_messages")
    .select("id, user_id, role, content, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(
      `Could not load saved chat history: ${error.message} Confirm the latest supabase/schema.sql has been run.`,
    );
  }
  return data.reverse();
}

export async function findRelevantContext(
  client: AppSupabaseClient,
  embedding: number[],
  excludeMessageId: string,
): Promise<{ messages: RetrievedChatMessage[]; memories: RetrievedMemory[] }> {
  const queryEmbedding = serializeEmbedding(embedding);
  const [messageResult, memoryResult] = await Promise.all([
    client.rpc("match_chat_messages", {
      query_embedding: queryEmbedding,
      result_limit: SEARCH_RESULT_LIMIT,
      exclude_message_id: excludeMessageId,
    }),
    client.rpc("match_user_memories", {
      query_embedding: queryEmbedding,
      result_limit: SEARCH_RESULT_LIMIT,
    }),
  ]);

  if (messageResult.error) {
    throw new Error(
      `Could not retrieve related chat history: ${messageResult.error.message} Confirm the latest supabase/schema.sql has been run.`,
    );
  }
  if (memoryResult.error) {
    throw new Error(
      `Could not retrieve related memories: ${memoryResult.error.message} Confirm the latest supabase/schema.sql has been run.`,
    );
  }
  return {
    messages: messageResult.data.filter((row) => row.similarity >= 0.35),
    memories: memoryResult.data.filter((row) => row.similarity >= 0.35),
  };
}

export async function loadRecentInsights(
  client: AppSupabaseClient,
  limit = 12,
  excludeMessageId?: string,
): Promise<Array<Pick<MessageInsight, "mood" | "communication_style" | "situation" | "topics" | "support_needs" | "summary">>> {
  let query = client
    .from("message_insights")
    .select("mood, communication_style, situation, topics, support_needs, summary")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (excludeMessageId) query = query.neq("message_id", excludeMessageId);
  const { data, error } = await query;
  if (error) {
    throw new Error(
      `Could not load conversation insights: ${error.message} Confirm the latest supabase/schema.sql has been run.`,
    );
  }
  return data.reverse();
}

export async function saveMessageInsight(
  client: AppSupabaseClient,
  messageId: string,
  insight: InsightDraft,
): Promise<void> {
  const { error } = await client.from("message_insights").insert({
    message_id: messageId,
    ...insight,
  });
  if (error) throw new Error(`Could not save message insight: ${error.message}`);
}

export async function saveAssistantRating(
  client: AppSupabaseClient,
  messageId: string,
  rating: "like" | "dislike" | null,
): Promise<void> {
  const { error: clearError } = await client
    .from("message_feedback")
    .delete()
    .eq("message_id", messageId)
    .in("kind", ["like", "dislike"]);
  if (clearError) {
    throw new Error(`Could not update message feedback: ${clearError.message}`);
  }
  if (!rating) return;

  const { error } = await client.from("message_feedback").insert({
    message_id: messageId,
    kind: rating,
  });
  if (error) throw new Error(`Could not save message feedback: ${error.message}`);
}

export async function saveAssistantReport(
  client: AppSupabaseClient,
  messageId: string,
  details: string,
): Promise<void> {
  const { error } = await client.from("message_feedback").insert({
    message_id: messageId,
    kind: "report",
    details,
  });
  if (error) throw new Error(`Could not save the response report: ${error.message}`);
}

export async function updateChatMessage(
  client: AppSupabaseClient,
  messageId: string,
  content: string,
  embedding: number[] | null,
): Promise<StoredChatMessage | null> {
  const { data, error } = await client
    .from("chat_messages")
    .update({
      content,
      embedding: embedding ? serializeEmbedding(embedding) : null,
    })
    .eq("id", messageId)
    .select("id, user_id, role, content, created_at")
    .maybeSingle();
  if (error) throw new Error(`Could not save the regenerated reply: ${error.message}`);
  return data;
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

async function searchUserData(
  client: AppSupabaseClient,
  args: Record<string, unknown>,
): Promise<unknown> {
  const query = requiredString(args.query, "search query", 200);
  const category = args.category;
  if (category !== "all" && category !== "chat" && category !== "memories" && category !== "insights") {
    throw new Error("Choose all, chat, memories, or insights as the search category.");
  }
  const pattern = searchPattern(query);
  const searches: Array<PromiseLike<unknown>> = [];

  if (category === "all" || category === "chat") {
    searches.push(
      client
        .from("chat_messages")
        .select("id, role, content, created_at")
        .ilike("content", pattern)
        .order("created_at", { ascending: false })
        .limit(SEARCH_RESULT_LIMIT)
        .then(({ data, error }) => {
          if (error) throw new Error(`Could not search chat history: ${error.message}`);
          return { category: "chat", records: data };
        }),
    );
  }
  if (category === "all" || category === "memories") {
    searches.push(
      client
        .from("user_memories")
        .select("id, category, content, updated_at")
        .ilike("content", pattern)
        .order("updated_at", { ascending: false })
        .limit(SEARCH_RESULT_LIMIT)
        .then(({ data, error }) => {
          if (error) throw new Error(`Could not search memories: ${error.message}`);
          return { category: "memories", records: data };
        }),
    );
  }
  if (category === "all" || category === "insights") {
    searches.push((async () => {
      const fields = ["summary", "mood", "communication_style", "situation", "support_needs"] as const;
      const results = await Promise.all(
        fields.map((field) =>
          client
            .from("message_insights")
            .select("id, message_id, mood, communication_style, situation, topics, support_needs, summary, created_at")
            .ilike(field, pattern)
            .order("created_at", { ascending: false })
            .limit(SEARCH_RESULT_LIMIT),
        ),
      );
      const failedResult = results.find((result) => result.error);
      if (failedResult?.error) {
        throw new Error(`Could not search insights: ${failedResult.error.message}`);
      }
      const uniqueInsights = new Map(
        results.flatMap((result) => result.data ?? []).map((insight) => [insight.id, insight]),
      );
      return {
        category: "insights",
        records: [...uniqueInsights.values()]
          .sort((first, second) => second.created_at.localeCompare(first.created_at))
          .slice(0, SEARCH_RESULT_LIMIT),
      };
    })());
  }
  return Promise.all(searches);
}

export async function executeChatDataTool(
  client: AppSupabaseClient,
  apiKey: string,
  name: string,
  input: unknown,
  confirmDelete: (label: string, preview: string) => boolean | Promise<boolean>,
): Promise<unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("The AI provided invalid database tool input.");
  }
  const args = input as Record<string, unknown>;

  if (name === "search_user_data") return searchUserData(client, args);

  if (name === "create_memory") {
    const content = requiredString(args.content, "memory content", 10000);
    const category = typeof args.category === "string" ? args.category.trim().slice(0, 80) : "general";
    const embedding = await createEmbedding(apiKey, content, "RETRIEVAL_DOCUMENT");
    const { data, error } = await client
      .from("user_memories")
      .insert({ content, category: category || "general", embedding: serializeEmbedding(embedding) })
      .select("id, category, content, created_at, updated_at")
      .single();
    if (error) throw new Error(`Could not create memory: ${error.message}`);
    return data;
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
    const { data, error } = await client
      .from("user_memories")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id, category, content, updated_at")
      .maybeSingle();
    if (error) throw new Error(`Could not update memory: ${error.message}`);
    if (!data) throw new Error("Memory not found in this user's database.");
    return data;
  }

  if (name === "delete_memory") {
    const id = requiredId(args.id, "memory ID");
    const { data: memory, error: readError } = await client
      .from("user_memories")
      .select("id, category, content")
      .eq("id", id)
      .maybeSingle();
    if (readError) throw new Error(`Could not load memory before deletion: ${readError.message}`);
    if (!memory) throw new Error("Memory not found in this user's database.");
    if (!(await confirmDelete("memory", memory.content))) {
      return { deleted: false, reason: "User cancelled deletion." };
    }
    const { error } = await client.from("user_memories").delete().eq("id", id);
    if (error) throw new Error(`Could not delete memory: ${error.message}`);
    return { deleted: true, category: memory.category, content: memory.content };
  }

  if (name === "update_chat_message") {
    const id = requiredId(args.id, "message ID");
    const content = requiredString(args.content, "message content", 50000);
    const embedding = serializeEmbedding(await createEmbedding(apiKey, content, "RETRIEVAL_DOCUMENT"));
    const { data, error } = await client
      .from("chat_messages")
      .update({ content, embedding })
      .eq("id", id)
      .select("id, role, content, created_at")
      .maybeSingle();
    if (error) throw new Error(`Could not update chat message: ${error.message}`);
    if (!data) throw new Error("Chat message not found in this user's database.");
    return data;
  }

  if (name === "delete_chat_message") {
    const id = requiredId(args.id, "message ID");
    const { data: message, error: readError } = await client
      .from("chat_messages")
      .select("id, role, content")
      .eq("id", id)
      .maybeSingle();
    if (readError) throw new Error(`Could not load chat message before deletion: ${readError.message}`);
    if (!message) throw new Error("Chat message not found in this user's database.");
    if (!(await confirmDelete("chat message", message.content))) {
      return { deleted: false, reason: "User cancelled deletion." };
    }
    const { error } = await client.from("chat_messages").delete().eq("id", id);
    if (error) throw new Error(`Could not delete chat message: ${error.message}`);
    return { deleted: true, role: message.role, content: message.content };
  }

  if (name === "update_message_insight") {
    const id = requiredId(args.id, "insight ID");
    const updates: Partial<InsightDraft> = {};
    for (const field of ["mood", "communication_style", "situation", "support_needs", "summary"] as const) {
      if (field in args) updates[field] = requiredString(args[field], field, 2000);
    }
    if ("topics" in args) {
      if (!Array.isArray(args.topics) || args.topics.some((topic) => typeof topic !== "string")) {
        throw new Error("Insight topics must be a list of text values.");
      }
      updates.topics = args.topics.slice(0, 20).map((topic) => topic.trim().slice(0, 100));
    }
    if (Object.keys(updates).length === 0) throw new Error("Provide at least one insight field to update.");
    const { data, error } = await client
      .from("message_insights")
      .update(updates)
      .eq("id", id)
      .select("id, message_id, mood, communication_style, situation, topics, support_needs, summary, created_at")
      .maybeSingle();
    if (error) throw new Error(`Could not update insight: ${error.message}`);
    if (!data) throw new Error("Insight not found in this user's database.");
    return data;
  }

  if (name === "delete_message_insight") {
    const id = requiredId(args.id, "insight ID");
    const { data: insight, error: readError } = await client
      .from("message_insights")
      .select("id, summary, mood")
      .eq("id", id)
      .maybeSingle();
    if (readError) throw new Error(`Could not load insight before deletion: ${readError.message}`);
    if (!insight) throw new Error("Insight not found in this user's database.");
    if (!(await confirmDelete("insight", insight.summary || insight.mood))) {
      return { deleted: false, reason: "User cancelled deletion." };
    }
    const { error } = await client.from("message_insights").delete().eq("id", id);
    if (error) throw new Error(`Could not delete insight: ${error.message}`);
    return { deleted: true, summary: insight.summary };
  }

  throw new Error(`Unsupported database action: ${name}`);
}
