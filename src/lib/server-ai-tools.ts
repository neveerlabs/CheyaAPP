import { start } from "workflow/api";
import {
  saveApiStatus,
  type AccountRole,
  type AiReminder,
  type AppSupabaseClient,
  type GeminiApiKey,
} from "./supabase";
import { generateProductHelpAnswer } from "./gemini";
import { createServiceRoleClient, getServerEnvironmentVariable } from "./server-supabase";
import { createAiReminderWorkflow } from "../../workflows/ai-reminder";
import { sendPushToAccount, sendPushToAccounts } from "./server-push";
import { searchProductHelp } from "./product-help";

const uuidPattern = /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

export class AccountAiToolError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "AccountAiToolError";
  }
}

function objectArgs(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AccountAiToolError("AI action input must be an object.", 400);
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new AccountAiToolError(`${name} must contain 1 to ${maxLength} characters.`, 400);
  }
  return value.trim();
}

function searchPattern(query: string): string {
  return query === "all" ? "%" : `%${query.replace(/[\\%_]/g, "\\$&")}%`;
}

async function getAdminPresence(
  client: AppSupabaseClient,
): Promise<{ adminIds: string[]; activeAdminIds: Set<string> | null }> {
  const { data: admins, error: adminsError } = await client
    .from("account_profiles")
    .select("user_id")
    .eq("role", "admin");
  if (adminsError) {
    console.error("Could not check admin presence for product-help request.", adminsError);
    return { adminIds: [], activeAdminIds: null };
  }
  const adminIds = admins.map((admin) => admin.user_id);
  if (adminIds.length === 0) return { adminIds, activeAdminIds: new Set() };

  const { data: activeSessions, error: sessionsError } = await client
    .from("account_sessions")
    .select("user_id")
    .in("user_id", adminIds)
    .eq("path", "/")
    .eq("is_active", true)
    .gt("last_seen_at", new Date(Date.now() - 45_000).toISOString());
  if (sessionsError) {
    console.error("Could not check active admin chat sessions for product-help request.", sessionsError);
    return { adminIds, activeAdminIds: null };
  }
  return { adminIds, activeAdminIds: new Set(activeSessions.map((session) => session.user_id)) };
}

function isReminderUnit(value: unknown): value is NonNullable<AiReminder["repeat_unit"]> {
  return (
    value === "minute" ||
    value === "hour" ||
    value === "day" ||
    value === "week" ||
    value === "month" ||
    value === "year"
  );
}

export function redactSensitiveText(text: string): string {
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/-----BEGIN [^-]*(?:PRIVATE KEY|RSA PRIVATE KEY)[^-]*-----[\s\S]*?-----END [^-]*-----/gi, "[REDACTED PRIVATE KEY]")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[REDACTED API KEY]")
    .replace(/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g, "[REDACTED API KEY]")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/g, "[REDACTED TOKEN]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[REDACTED TOKEN]")
    .replace(
      /\b(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|password|credential)\s*[:=]\s*("[^"]+"|'[^']+'|[^\s,;]+)/gi,
      "$1=[REDACTED]",
    );
}

function redactSensitiveValue(value: unknown): unknown {
  if (typeof value === "string") return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map(redactSensitiveValue);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, redactSensitiveValue(nestedValue)]),
    );
  }
  return value;
}

function redactRecordStrings(records: object[]): unknown[] {
  return records.map(redactSensitiveValue);
}

function uniqueRecentRecords<T>(
  groups: Array<T[] | null>,
  limit: number,
  identify: (record: T) => string,
): T[] {
  return [...new Map(groups.flatMap((group) => group ?? []).map((record) => [identify(record), record])).values()]
    .slice(0, limit);
}

async function accountRole(client: AppSupabaseClient, userId: string): Promise<AccountRole> {
  const { data, error } = await client
    .from("account_profiles")
    .select("role")
    .eq("user_id", userId)
    .single();
  if (error) throw new Error(`Could not verify account role: ${error.message}`);
  if (data.role !== "admin" && data.role !== "user") {
    throw new Error("The account has an invalid role.");
  }
  return data.role;
}

async function searchAllAccountData(
  client: AppSupabaseClient,
  args: Record<string, unknown>,
): Promise<unknown> {
  const query = requiredText(args.query, "Search query", 200).toLocaleLowerCase();
  const category = args.category;
  const pattern = searchPattern(query);
  const all = query === "all";
  if (
    category !== "accounts" &&
    category !== "chat" &&
    category !== "message_versions" &&
    category !== "branches" &&
    category !== "jobs" &&
    category !== "insights" &&
    category !== "memories" &&
    category !== "feedback" &&
    category !== "settings" &&
    category !== "sessions" &&
    category !== "attachments" &&
    category !== "admin_messages" &&
    category !== "inbox" &&
    category !== "reminders"
  ) {
    throw new AccountAiToolError("Choose a supported account data category.", 400);
  }

  if (category === "accounts") {
    let request = client
      .from("account_profiles")
      .select("user_id, role, provider, email, github_username, updated_at")
      .order("updated_at", { ascending: false })
      .limit(50);
    if (!all) {
      if (uuidPattern.test(query)) request = request.eq("user_id", query);
      else if (query.includes("@")) request = request.ilike("email", pattern);
      else request = request.ilike("github_username", pattern);
    }
    const { data, error } = await request;
    if (error) throw new Error(`Could not search account profiles: ${error.message}`);
    return { category, records: data };
  }

  if (category === "chat") {
    const request = client
      .from("chat_messages")
      .select("id, user_id, role, content, created_at")
      .ilike("content", pattern)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(20);
    const { data, error } = await request;
    if (error) throw new Error(`Could not search account messages: ${error.message}`);
    return { category, records: redactRecordStrings(data) };
  }

  if (category === "message_versions") {
    const { data, error } = await client
      .from("chat_message_versions")
      .select("id, user_id, message_id, version_number, content, revision_reason, created_at")
      .ilike("content", pattern)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(`Could not search prior chat message versions: ${error.message}`);
    return { category, records: redactRecordStrings(data) };
  }

  if (category === "branches") {
    const { data, error } = await client
      .from("chat_conversation_branches")
      .select("id, user_id, anchor_message_id, anchor_version_number, messages, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(`Could not search saved chat branches: ${error.message}`);
    const records = all
      ? data
      : data.filter((branch) => JSON.stringify(branch.messages).toLocaleLowerCase().includes(query));
    return { category, records: redactRecordStrings(records.slice(0, 30)) };
  }

  if (category === "jobs") {
    const { data, error } = await client
      .from("chat_message_jobs")
      .select("id, user_id, message_id, assistant_message_id, thinking_mode, status, progress, error, created_at, updated_at")
      .ilike("progress", pattern)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw new Error(`Could not search chat processing records: ${error.message}`);
    return { category, records: redactRecordStrings(data) };
  }

  if (category === "insights") {
    const select = "id, user_id, message_id, mood, communication_style, situation, topics, support_needs, summary, created_at";
    const base = () => client.from("message_insights").select(select).order("created_at", { ascending: false }).limit(20);
    const results = await Promise.all([
      base().ilike("summary", pattern),
      base().ilike("situation", pattern),
      base().ilike("communication_style", pattern),
      base().ilike("support_needs", pattern),
      base().ilike("mood", pattern),
      base().contains("topics", [query]),
    ]);
    const error = results.find((result) => result.error)?.error;
    if (error) throw new Error(`Could not search account insights: ${error.message}`);
    return {
      category,
      records: redactRecordStrings(
        uniqueRecentRecords(results.map((result) => result.data), 30, (record) => record.id),
      ),
    };
  }

  if (category === "memories") {
    const [contentResult, categoryResult] = await Promise.all([
      client
        .from("user_memories")
        .select("id, user_id, category, content, updated_at")
        .ilike("content", pattern)
        .order("updated_at", { ascending: false })
        .limit(20),
      client
        .from("user_memories")
        .select("id, user_id, category, content, updated_at")
        .ilike("category", pattern)
        .order("updated_at", { ascending: false })
        .limit(20),
    ]);
    if (contentResult.error || categoryResult.error) {
      throw new Error(`Could not search account memories: ${contentResult.error?.message ?? categoryResult.error?.message}`);
    }
    return {
      category,
      records: redactRecordStrings(
        uniqueRecentRecords([contentResult.data, categoryResult.data], 30, (record) => record.id),
      ),
    };
  }

  if (category === "feedback") {
    const detailsResult = await client
      .from("message_feedback")
      .select("id, user_id, message_id, version_number, kind, details, created_at")
      .ilike("details", pattern)
      .order("created_at", { ascending: false })
      .limit(20);
    if (detailsResult.error) throw new Error(`Could not search account feedback: ${detailsResult.error.message}`);
    const kindResult =
      query === "like" || query === "dislike" || query === "report"
        ? await client
            .from("message_feedback")
            .select("id, user_id, message_id, version_number, kind, details, created_at")
            .eq("kind", query)
            .order("created_at", { ascending: false })
            .limit(20)
        : null;
    if (kindResult?.error) throw new Error(`Could not search account feedback: ${kindResult.error.message}`);
    return {
      category,
      records: redactRecordStrings(uniqueRecentRecords(
        [detailsResult.data, ...(kindResult ? [kindResult.data] : [])],
        30,
        (record) => record.id,
      )),
    };
  }

  if (category === "settings") {
    const select = "user_id, display_name, custom_prompt, chat_style, updated_at";
    const base = () => client.from("user_settings").select(select).order("updated_at", { ascending: false }).limit(20);
    const results = await Promise.all([
      base().ilike("display_name", pattern),
      base().ilike("custom_prompt", pattern),
      base().ilike("chat_style", pattern),
    ]);
    const error = results.find((result) => result.error)?.error;
    if (error) throw new Error(`Could not search safe account settings: ${error.message}`);
    return {
      category,
      records: redactRecordStrings(
        uniqueRecentRecords(results.map((result) => result.data), 30, (record) => record.user_id),
      ),
    };
  }

  if (category === "sessions") {
    let request = client
      .from("account_sessions")
      .select("id, user_id, origin, path, user_agent, started_at, last_seen_at, is_active")
      .order("last_seen_at", { ascending: false })
      .limit(50);
    if (!all) {
      if (uuidPattern.test(query)) request = request.eq("user_id", query);
      else request = request.ilike("user_agent", pattern);
    }
    const { data, error } = await request;
    if (error) throw new Error(`Could not search account sessions: ${error.message}`);
    return { category, records: redactRecordStrings(data) };
  }

  if (category === "attachments") {
    const { data, error } = await client
      .from("chat_message_attachments")
      .select("id, user_id, message_id, file_name, mime_type, size_bytes, created_at, expires_at")
      .ilike("file_name", pattern)
      .is("deleted_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw new Error(`Could not search unexpired account attachments: ${error.message}`);
    return { category, records: data };
  }

  if (category === "admin_messages") {
    const { data, error } = await client
      .from("admin_messages")
      .select("id, sender_user_id, body, attachment_id, created_at")
      .ilike("body", pattern)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw new Error(`Could not search messages sent to admins: ${error.message}`);
    return { category, records: redactRecordStrings(data) };
  }

  if (category === "inbox") {
    const { data, error } = await client
      .from("account_inbox")
      .select("id, recipient_user_id, sender_user_id, source_job_id, kind, title, body, created_at, read_at")
      .ilike("body", pattern)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw new Error(`Could not search account inbox messages: ${error.message}`);
    return { category, records: redactRecordStrings(data) };
  }

  const { data, error } = await client
    .from("ai_reminders")
    .select("id, user_id, title, body, next_run_at, timezone, repeat_interval_seconds, repeat_every, repeat_unit, active, created_at, completed_at")
    .ilike("body", pattern)
    .order("next_run_at", { ascending: false })
    .limit(30);
  if (error) throw new Error(`Could not search account reminders: ${error.message}`);
  return { category, records: redactRecordStrings(data) };
}

async function executeAuthorizedAction(
  client: AppSupabaseClient,
  actorId: string,
  role: AccountRole,
  name: string,
  value: unknown,
  sourceMessageId?: string,
  rawProductHelpForServerModel = false,
): Promise<unknown> {
  const args = objectArgs(value);
  if (name === "search_product_help") {
    const query = requiredText(args.query, "Product-help query", 500);
    const help = await searchProductHelp(client, query);
    if (!help.found) return { found: false };
    if (rawProductHelpForServerModel) return help;

    const { data: storedKeys, error: keysError } = await client
      .from("ai_api_keys")
      .select("id, model, api_key, status, last_error, created_at")
      .eq("user_id", actorId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (keysError) throw new Error(`Could not load Gemini keys to answer product help: ${keysError.message}`);
    if (storedKeys.length === 0) {
      throw new AccountAiToolError("Add a Gemini API key in Settings before asking about CheyaAPP.", 400);
    }

    const typedKeys: GeminiApiKey[] = storedKeys;
    const result = await generateProductHelpAnswer(
      typedKeys,
      query,
      help.articles,
    );
    await Promise.all(
      result.attempts.map(async (attempt) => {
        try {
          await saveApiStatus(client, attempt, actorId);
        } catch (error) {
          console.warn(
            "The product-help Gemini API status could not be saved.",
            error,
          );
        }
      }),
    );
    return {
      found: result.answer !== null,
      ...(result.answer !== null ? { answer: result.answer } : {}),
    };
  }

  if (name === "start_admin_public_memory_request") {
    if (role !== "admin") {
      throw new AccountAiToolError("Only administrators can start public-memory requests.", 403);
    }
    if (!sourceMessageId || !uuidPattern.test(sourceMessageId)) {
      throw new AccountAiToolError("The administrator question could not be verified.", 400);
    }
    const question = redactSensitiveText(requiredText(args.question, "Question", 10000));
    const { data, error } = await client.rpc("start_admin_public_memory_request", {
      p_admin_user_id: actorId,
      p_source_message_id: sourceMessageId,
      p_question: question,
    });
    if (error) throw new Error(`Could not save the administrator's product question: ${error.message}`);
    const request = data[0];
    if (!request) throw new Error("The public-memory request service returned no result.");
    return { requestId: request.request_id, alreadyExists: request.was_existing };
  }

  if (name === "search_admin_public_memory_requests") {
    if (role !== "admin") {
      throw new AccountAiToolError("Only administrators can search their public-memory requests.", 403);
    }
    const query = typeof args.query === "string" ? args.query.trim().slice(0, 200) : "";
    const { data, error } = await client.rpc("search_admin_public_memory_requests", {
      p_admin_user_id: actorId,
      p_query: query,
    });
    if (error) throw new Error(`Could not search public-memory requests: ${error.message}`);
    return data;
  }

  if (name === "prepare_admin_public_memory") {
    if (role !== "admin") {
      throw new AccountAiToolError("Only administrators can prepare public-memory drafts.", 403);
    }
    const requestId = requiredText(args.request_id, "Request ID", 36);
    if (!uuidPattern.test(requestId)) {
      throw new AccountAiToolError("The public-memory request ID is invalid.", 400);
    }
    const title = redactSensitiveText(requiredText(args.title, "Title", 160));
    const content = redactSensitiveText(requiredText(args.content, "Content", 10000));
    const { data, error } = await client.rpc("prepare_admin_public_memory", {
      p_admin_user_id: actorId,
      p_request_id: requestId,
      p_title: title,
      p_content: content,
    });
    if (error) throw new Error(`Could not save the public-memory draft: ${error.message}`);
    const draft = data[0];
    if (!draft) throw new Error("The public-memory service did not confirm the draft.");
    return {
      requestId: draft.request_id,
      title: draft.draft_title,
      content: draft.draft_content,
      requiresAdminConfirmation: true,
      published: false,
    };
  }

  if (name === "confirm_admin_public_memory") {
    if (role !== "admin") {
      throw new AccountAiToolError("Only administrators can confirm public memory.", 403);
    }
    if (!sourceMessageId || !uuidPattern.test(sourceMessageId)) {
      throw new AccountAiToolError("The administrator confirmation could not be verified.", 400);
    }
    const requestId = requiredText(args.request_id, "Request ID", 36);
    if (!uuidPattern.test(requestId)) {
      throw new AccountAiToolError("The public-memory request ID is invalid.", 400);
    }
    const { data, error } = await client.rpc("confirm_admin_public_memory", {
      p_admin_user_id: actorId,
      p_request_id: requestId,
      p_confirmation_message_id: sourceMessageId,
    });
    if (error) throw new Error(`Could not publish the confirmed public-memory article: ${error.message}`);
    const published = data[0];
    if (!published) throw new Error("The public-memory service did not confirm publication.");
    return {
      published: true,
      alreadyPublished: published.was_existing,
      title: published.title,
      memoryId: published.public_memory_id,
    };
  }

  if (name === "ask_admin_product_question") {
    if (role !== "user") {
      throw new AccountAiToolError("Only user accounts can ask for product-help answers.", 403);
    }
    if (!sourceMessageId || !uuidPattern.test(sourceMessageId)) {
      throw new AccountAiToolError("The source chat question could not be verified.", 400);
    }
    const question = redactSensitiveText(requiredText(args.question, "Question", 10000));
    const { data: created, error: requestError } = await client.rpc(
      "request_product_help_from_admin",
      {
        p_user_id: actorId,
        p_source_message_id: sourceMessageId,
        p_question: question,
      },
    );
    if (requestError) {
      throw new Error(`Could not forward the product-help question: ${requestError.message}`);
    }
    const request = created[0];
    if (!request) throw new Error("The product-help service did not return the new request.");
    const { adminIds, activeAdminIds } = await getAdminPresence(client);
    if (request.was_existing) {
      return {
        delivered: true,
        alreadyForwarded: true,
        requestId: request.request_id,
        adminActive: activeAdminIds === null ? null : activeAdminIds.size > 0,
      };
    }

    if (activeAdminIds === null) {
      return {
        delivered: true,
        requestId: request.request_id,
        adminActive: null,
        pushWarning: "Admin availability could not be verified.",
      };
    }
    const pushRecipientIds = adminIds
      .filter((userId) => !activeAdminIds.has(userId));
    if (pushRecipientIds.length === 0) {
      return {
        delivered: true,
        requestId: request.request_id,
        adminActive: activeAdminIds.size > 0,
        pushSent: false,
      };
    }
    try {
      const push = await sendPushToAccounts(
        pushRecipientIds,
        "CheyaAPP user needs help",
        question.slice(0, 280),
      );
      return {
        delivered: true,
        requestId: request.request_id,
        adminActive: false,
        push,
      };
    } catch (error) {
      console.error("Product-help question was delivered to admin chats, but push delivery failed.", error);
      return {
        delivered: true,
        requestId: request.request_id,
        adminActive: false,
        pushWarning: error instanceof Error ? error.message : "Unknown push service error.",
      };
    }
  }

  if (name === "check_product_help_status") {
    if (role !== "user") {
      throw new AccountAiToolError("Only user accounts can check their product-help requests.", 403);
    }
    const query = typeof args.query === "string" ? args.query.trim().slice(0, 200) : "";
    let request = client
      .from("product_help_requests")
      .select("id, question, status, created_at")
      .eq("user_id", actorId)
      .in("status", ["pending", "awaiting_confirmation", "answered"])
      .order("created_at", { ascending: false })
      .limit(10);
    if (query) request = request.ilike("question", `%${query.replace(/[\\%_]/g, "\\$&")}%`);
    const { data, error } = await request;
    if (error) throw new Error(`Could not check product-help request status: ${error.message}`);
    const presence = await getAdminPresence(client);
    return {
      requests: data.map(({ id, question, status, created_at }) => ({
        id,
        question,
        status,
        created_at,
      })),
      adminActive:
        presence.activeAdminIds === null
          ? null
          : presence.activeAdminIds.size > 0,
    };
  }

  if (name === "search_pending_product_questions") {
    if (role !== "admin") {
      throw new AccountAiToolError("Only administrators can search pending product-help questions.", 403);
    }
    const query = typeof args.query === "string" ? args.query.trim().slice(0, 200) : "";
    let request = client
      .from("product_help_requests")
      .select("id, user_id, question, status, draft_title, draft_answer, draft_created_at, created_at")
      .in("status", ["pending", "awaiting_confirmation"])
      .order("created_at", { ascending: false })
      .limit(20);
    if (query) request = request.ilike("question", `%${query.replace(/[\\%_]/g, "\\$&")}%`);
    const { data, error } = await request;
    if (error) {
      throw new Error(`Could not search pending product-help questions: ${error.message}`);
    }
    return data;
  }

  if (name === "prepare_product_help_answer") {
    if (role !== "admin") {
      throw new AccountAiToolError("Only administrators can prepare product-help answers.", 403);
    }
    const requestId = requiredText(args.request_id, "Request ID", 36);
    if (!uuidPattern.test(requestId)) {
      throw new AccountAiToolError("The product-help request ID is invalid.", 400);
    }
    const answer = redactSensitiveText(requiredText(args.answer, "Answer", 10000));
    const title = redactSensitiveText(requiredText(args.title, "Title", 160));
    const { data: prepared, error: prepareError } = await client.rpc(
      "prepare_product_help_answer",
      {
        p_admin_user_id: actorId,
        p_request_id: requestId,
        p_title: title,
        p_answer: answer,
      },
    );
    if (prepareError) {
      throw new Error(`Could not save the product-help answer draft: ${prepareError.message}`);
    }
    const draft = prepared[0];
    if (!draft) throw new Error("The product-help service did not confirm the saved draft.");
    return {
      prepared: true,
      requestId: draft.request_id,
      draftTitle: draft.draft_title,
      draftAnswer: draft.draft_answer,
      draftCreatedAt: draft.draft_created_at,
      requiresAdminConfirmation: true,
      sentToUser: false,
    };
  }

  if (name === "confirm_product_help_answer") {
    if (role !== "admin") {
      throw new AccountAiToolError("Only administrators can confirm product-help answers.", 403);
    }
    if (!sourceMessageId || !uuidPattern.test(sourceMessageId)) {
      throw new AccountAiToolError("The administrator confirmation message could not be verified.", 400);
    }
    const requestId = requiredText(args.request_id, "Request ID", 36);
    if (!uuidPattern.test(requestId)) {
      throw new AccountAiToolError("The product-help request ID is invalid.", 400);
    }
    const { data: answered, error: answerError } = await client.rpc(
      "confirm_product_help_answer",
      {
        p_admin_user_id: actorId,
        p_request_id: requestId,
        p_confirmation_message_id: sourceMessageId,
      },
    );
    if (answerError) {
      throw new Error(`Could not deliver the confirmed product-help answer: ${answerError.message}`);
    }
    const delivery = answered[0];
    if (!delivery) throw new Error("The answer service did not confirm delivery.");
    if (delivery.was_existing) {
      return {
        delivered: true,
        alreadyAnswered: true,
        answerMessageId: delivery.answer_message_id,
      };
    }
    if (typeof delivery.answer !== "string" || !delivery.answer.trim()) {
      throw new Error("The confirmed answer service returned an invalid answer.");
    }

    const { data: activeSessions, error: sessionsError } = await client
      .from("account_sessions")
      .select("user_id")
      .eq("user_id", delivery.user_id)
      .eq("path", "/")
      .eq("is_active", true)
      .gt("last_seen_at", new Date(Date.now() - 45_000).toISOString());
    if (sessionsError) {
      console.error("Product-help answer was delivered to the user's chat, but their active session could not be checked.", sessionsError);
      return {
        delivered: true,
        answerMessageId: delivery.answer_message_id,
        pushWarning: sessionsError.message,
      };
    }
    if (activeSessions.length > 0) {
      return { delivered: true, answerMessageId: delivery.answer_message_id, pushSent: false };
    }
    try {
      const push = await sendPushToAccount(
        delivery.user_id,
        "CheyaAPP support answered",
        delivery.answer.slice(0, 280),
      );
      return { delivered: true, answerMessageId: delivery.answer_message_id, push };
    } catch (error) {
      console.error("Product-help answer was delivered to the user's chat, but push delivery failed.", error);
      return {
        delivered: true,
        answerMessageId: delivery.answer_message_id,
        pushWarning: error instanceof Error ? error.message : "Unknown push service error.",
      };
    }
  }

  if (name === "send_message_to_admin") {
    if (role !== "user") {
      throw new AccountAiToolError("Only user accounts can send a message to the administrator.", 403);
    }
    if (!sourceMessageId || !uuidPattern.test(sourceMessageId)) {
      throw new AccountAiToolError("The source chat message could not be verified for delivery.", 400);
    }
    const body = requiredText(args.body, "Message", 10000);
    const safeBody = redactSensitiveText(body);
    const [profileResult, settingsResult] = await Promise.all([
      client
        .from("account_profiles")
        .select("email, github_username")
        .eq("user_id", actorId)
        .single(),
      client
        .from("user_settings")
        .select("display_name")
        .eq("user_id", actorId)
        .maybeSingle(),
    ]);
    if (profileResult.error) {
      throw new Error(`Could not load the sender's account identity: ${profileResult.error.message}`);
    }
    if (settingsResult.error) {
      throw new Error(`Could not load the sender's display name: ${settingsResult.error.message}`);
    }
    const displayName = settingsResult.data?.display_name.replace(/[\r\n]/g, " ").trim();
    const identity = [
      displayName,
      profileResult.data.github_username
        ? `GitHub @${profileResult.data.github_username}`
        : null,
      profileResult.data.email,
    ].filter((part): part is string => Boolean(part));
    if (identity.length === 0) identity.push(`Account ${actorId}`);
    const attributedBody = `Message from ${identity.join(" · ")}:\n\n${safeBody}`;
    if (attributedBody.length > 10000) {
      throw new AccountAiToolError(
        "The message is too long after adding sender details. Shorten it and try again.",
        400,
      );
    }
    const { data, error } = await client.rpc("relay_user_message_to_admin", {
      p_sender_user_id: actorId,
      p_body: attributedBody,
      p_source_message_id: sourceMessageId,
    });
    if (error) throw new Error(`Could not deliver your message to the administrator: ${error.message}`);
    const { data: admins, error: adminsError } = await client
      .from("account_profiles")
      .select("user_id")
      .eq("role", "admin");
    if (adminsError) {
      console.error("The user message was saved, but administrator accounts could not be loaded for push delivery.", adminsError);
      return {
        delivered: true,
        messageId: data,
        sensitiveTextRedacted: safeBody !== body,
        pushWarning: adminsError.message,
      };
    }
    try {
      const push = await sendPushToAccounts(
        admins.map((admin) => admin.user_id),
        "Message for the administrator",
        attributedBody,
      );
      return {
        delivered: true,
        messageId: data,
        sensitiveTextRedacted: safeBody !== body,
        push,
      };
    } catch (pushError) {
      const detail = pushError instanceof Error ? pushError.message : "Unknown push service error.";
      console.error("The user message was saved, but its administrator push notification failed.", pushError);
      return {
        delivered: true,
        messageId: data,
        sensitiveTextRedacted: safeBody !== body,
        pushWarning: detail,
      };
    }
  }

  if (name === "send_push_notification") {
    const title = requiredText(args.title, "Notification title", 80);
    const body = requiredText(args.body, "Notification body", 300);
    const push = await sendPushToAccount(actorId, title, body);
    if (push.skippedActive) {
      return { sentToDevices: 0, attemptedDevices: 0, skippedBecauseAccountActiveInChat: true };
    }
    if (push.attempted === 0) {
      throw new AccountAiToolError(
        "No push-enabled device is registered for this account. Enable notifications on a device first.",
        409,
      );
    }
    return { sentToDevices: push.sent, attemptedDevices: push.attempted, failed: push.failed };
  }

  if (name === "share_chat_attachment") {
    const attachmentId = requiredText(args.attachment_id, "Attachment ID", 36);
    if (!uuidPattern.test(attachmentId)) {
      throw new AccountAiToolError("Attachment ID must be a valid ID from an attachment search.", 400);
    }
    const requestedOwnerId =
      args.user_id === undefined ? null : requiredText(args.user_id, "Attachment owner ID", 36);
    if (requestedOwnerId && !uuidPattern.test(requestedOwnerId)) {
      throw new AccountAiToolError("Attachment owner ID must be a valid account ID.", 400);
    }
    if (role !== "admin" && requestedOwnerId && requestedOwnerId !== actorId) {
      throw new AccountAiToolError("User accounts can only share their own uploads.", 403);
    }
    let request = client
      .from("chat_message_attachments")
      .select("id, user_id, message_id, file_name, mime_type, size_bytes, expires_at")
      .eq("id", attachmentId)
      .is("deleted_at", null)
      .gt("expires_at", new Date().toISOString())
      .not("message_id", "is", null);
    if (role !== "admin") request = request.eq("user_id", actorId);
    else if (requestedOwnerId) request = request.eq("user_id", requestedOwnerId);
    const { data: attachment, error } = await request.maybeSingle();
    if (error) throw new Error(`Could not load the requested attachment: ${error.message}`);
    if (!attachment) {
      throw new AccountAiToolError("That upload is expired, unavailable, or not owned by the requested account.", 404);
    }
    return {
      attachmentId: attachment.id,
      sourceUserId: attachment.user_id,
      fileName: attachment.file_name,
      mimeType: attachment.mime_type,
      sizeBytes: attachment.size_bytes,
      expiresAt: attachment.expires_at,
      reusedOriginalUpload: true,
    };
  }

  if (name === "search_all_account_data") {
    if (role !== "admin") {
      throw new AccountAiToolError("Only administrators may search across accounts.", 403);
    }
    return searchAllAccountData(client, args);
  }

  if (name === "prepare_admin_message") {
    if (role !== "admin") {
      throw new AccountAiToolError("Only administrators may prepare messages to other accounts.", 403);
    }
    if (!Array.isArray(args.recipient_user_ids) || args.recipient_user_ids.length > 1000) {
      throw new AccountAiToolError("Provide up to 1,000 exact recipient IDs from account search.", 400);
    }
    const requestedRecipients = args.recipient_user_ids.map((id) => {
      if (typeof id !== "string" || !uuidPattern.test(id)) {
        throw new AccountAiToolError("Every recipient must be an exact account ID returned by account search.", 400);
      }
      return id;
    });
    let recipientIds = [...new Set(requestedRecipients)];
    const clientForData = createServiceRoleClient();
    const allAccounts = recipientIds.length === 0;
    if (!allAccounts) {
      const { data, error } = await clientForData
        .from("account_profiles")
        .select("user_id")
        .in("user_id", recipientIds);
      if (error) throw new Error(`Could not verify message recipients: ${error.message}`);
      if (data.length !== recipientIds.length) {
        throw new AccountAiToolError("One or more recipient IDs are not valid accounts.", 400);
      }
    }
    const { data, error } = await clientForData
      .from("admin_message_requests")
      .insert({
        admin_user_id: actorId,
        recipient_user_ids: recipientIds,
        all_accounts: allAccounts,
        title: requiredText(args.title, "Message title", 200),
        body: requiredText(args.body, "Message body", 10000),
      })
      .select("id, admin_user_id, recipient_user_ids, all_accounts, title, body, status, created_at")
      .single();
    if (error) throw new Error(`Could not stage the message for approval: ${error.message}`);
    return {
      pendingApproval: true,
      request: data,
      instruction: "Show a preview and tell the admin to approve it from the notification inbox in the chat header.",
    };
  }

  if (name === "forward_user_attachment_to_admin") {
    if (role !== "admin") {
      throw new AccountAiToolError("Only administrators may request another account's attachment.", 403);
    }
    const attachmentId = requiredText(args.attachment_id, "Attachment ID", 36);
    const userId = requiredText(args.user_id, "Account ID", 36);
    if (!uuidPattern.test(attachmentId) || !uuidPattern.test(userId)) {
      throw new AccountAiToolError("The attachment and account IDs must be valid IDs from search results.", 400);
    }
    const clientForData = createServiceRoleClient();
    const { data: attachment, error: attachmentError } = await clientForData
      .from("chat_message_attachments")
      .select("id, user_id, storage_path, file_name, mime_type, expires_at, deleted_at")
      .eq("id", attachmentId)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (attachmentError) throw new Error(`Could not verify the file: ${attachmentError.message}`);
    if (!attachment) throw new Error("That file has expired or is no longer available.");
    const body = typeof args.body === "string" ? args.body.trim().slice(0, 10000) : "";
    const messageBody = [
      body,
      `Forwarded attachment from account ${userId}: ${attachment.file_name} (${attachment.mime_type}).`,
    ].filter(Boolean).join("\n\n");
    const { data, error } = await clientForData
      .from("admin_messages")
      .insert({
        sender_user_id: userId,
        body: messageBody,
        attachment_id: attachment.id,
      })
      .select("id, created_at")
      .single();
    if (error) throw new Error(`Could not forward the file to the administrator: ${error.message}`);
    return { forwarded: true, fileName: attachment.file_name, ...data };
  }

  if (name === "create_reminder") {
    if (!sourceMessageId) {
      throw new AccountAiToolError("Create reminders from a chat message so duplicate requests can be prevented.", 400);
    }
    const title = requiredText(args.title, "Reminder title", 120);
    const body = requiredText(args.body, "Reminder message", 10000);
    const runAt = requiredText(args.run_at, "Reminder time", 64);
    const runAtDate = new Date(runAt);
    if (
      !/([zZ]|[+-]\d{2}:\d{2})$/.test(runAt) ||
      !Number.isFinite(runAtDate.getTime()) ||
      runAtDate.getTime() <= Date.now()
    ) {
      throw new AccountAiToolError("The reminder time must be a valid future timestamp.", 400);
    }
    const requestedRepeatEvery = args.repeat_every;
    const requestedRepeatUnit = args.repeat_unit;
    let repeatEvery: number | null = null;
    let repeatUnit: AiReminder["repeat_unit"] = null;
    const repeatInterval =
      args.repeat_interval_seconds === undefined ? null : args.repeat_interval_seconds;
    if (
      repeatInterval !== null &&
      (typeof repeatInterval !== "number" ||
        !Number.isInteger(repeatInterval) ||
        repeatInterval < 60 ||
        repeatInterval > 31_536_000)
    ) {
      throw new AccountAiToolError("Repeat intervals must be whole seconds between one minute and one year.", 400);
    }
    if (requestedRepeatEvery !== undefined || requestedRepeatUnit !== undefined) {
      if (
        typeof requestedRepeatEvery !== "number" ||
        !Number.isInteger(requestedRepeatEvery) ||
        requestedRepeatEvery < 1 ||
        requestedRepeatEvery > 1000 ||
        !isReminderUnit(requestedRepeatUnit)
      ) {
        throw new AccountAiToolError("Choose a valid repeat interval and unit, or leave both out for a one-time reminder.", 400);
      }
      repeatEvery = requestedRepeatEvery;
      repeatUnit = requestedRepeatUnit;
    }
    if (repeatInterval !== null && repeatEvery !== null) {
      throw new AccountAiToolError("Choose a valid repeat interval and unit, or leave both out for a one-time reminder.", 400);
    }
    const { data: existingReminder, error: existingReminderError } = await client
      .from("ai_reminders")
      .select("id, title, next_run_at, repeat_interval_seconds, repeat_every, repeat_unit, active")
      .eq("user_id", actorId)
      .eq("source_message_id", sourceMessageId)
      .maybeSingle();
    if (existingReminderError) {
      throw new Error(`Could not check for an existing reminder: ${existingReminderError.message}`);
    }
    if (existingReminder) {
      return { scheduled: true, alreadyScheduled: true, ...existingReminder, timezone: "Asia/Jakarta" };
    }
    if (
      !getServerEnvironmentVariable("VAPID_PUBLIC_KEY") ||
      !getServerEnvironmentVariable("VAPID_PRIVATE_KEY") ||
      !getServerEnvironmentVariable("VAPID_SUBJECT")
    ) {
      throw new Error("Configure VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT before scheduling reminders.");
    }
    const clientForData = createServiceRoleClient();
    const { count, error: subscriptionError } = await clientForData
      .from("push_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", actorId);
    if (subscriptionError) {
      throw new Error(`Could not verify push notification setup: ${subscriptionError.message}`);
    }
    if (!count) {
      throw new Error("Enable push notifications for reminders in Settings on this device, then ask me again.");
    }
    const { data, error } = await clientForData
      .from("ai_reminders")
      .insert({
        user_id: actorId,
        source_message_id: sourceMessageId,
        title,
        body,
        next_run_at: runAtDate.toISOString(),
        timezone: "Asia/Jakarta",
        repeat_interval_seconds: repeatInterval,
        repeat_every: repeatEvery,
        repeat_unit: repeatUnit,
      })
      .select("id, title, next_run_at, repeat_interval_seconds, repeat_every, repeat_unit")
      .single();
    if (error) {
      if (error.code === "23505") {
        const { data: duplicateReminder, error: duplicateReadError } = await clientForData
          .from("ai_reminders")
          .select("id, title, next_run_at, repeat_interval_seconds, repeat_every, repeat_unit, active")
          .eq("user_id", actorId)
          .eq("source_message_id", sourceMessageId)
          .maybeSingle();
        if (duplicateReadError) {
          throw new Error(`Could not load the existing reminder after a duplicate request: ${duplicateReadError.message}`);
        }
        if (duplicateReminder) {
          return { scheduled: true, alreadyScheduled: true, ...duplicateReminder, timezone: "Asia/Jakarta" };
        }
      }
      throw new Error(`Could not save the reminder: ${error.message}`);
    }
    try {
      await start(createAiReminderWorkflow, [data.id]);
    } catch (error) {
      const { error: deactivateError } = await clientForData
        .from("ai_reminders")
        .update({ active: false })
        .eq("id", data.id);
      if (deactivateError) {
        throw new Error(
          `The reminder was saved but workflow scheduling failed (${error instanceof Error ? error.message : "unknown error"}); deactivation failed too: ${deactivateError.message}`,
        );
      }
      throw new Error(
        `The reminder was saved but could not be scheduled: ${error instanceof Error ? error.message : "workflow start failed."}`,
      );
    }
    return { scheduled: true, ...data, timezone: "Asia/Jakarta" };
  }

  if (name === "search_reminders") {
    const clientForData = createServiceRoleClient();
    const { data, error } = await clientForData
      .from("ai_reminders")
      .select("id, title, body, next_run_at, timezone, repeat_interval_seconds, repeat_every, repeat_unit, active")
      .eq("user_id", actorId)
      .eq("active", true)
      .order("next_run_at", { ascending: true })
      .limit(50);
    if (error) throw new Error(`Could not search reminders: ${error.message}`);
    return data;
  }

  if (name === "cancel_reminder") {
    const id = requiredText(args.id, "Reminder ID", 36);
    if (!uuidPattern.test(id)) throw new AccountAiToolError("Reminder ID must be a valid UUID.", 400);
    const clientForData = createServiceRoleClient();
    const { data, error } = await clientForData
      .from("ai_reminders")
      .update({ active: false })
      .eq("id", id)
      .eq("user_id", actorId)
      .eq("active", true)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(`Could not cancel reminder: ${error.message}`);
    if (!data) throw new AccountAiToolError("That active reminder was not found in this account.", 404);
    return { cancelled: true, id };
  }

  throw new AccountAiToolError(`The requested account AI action is not supported: ${name}`, 400);
}

export async function executeAccountAiTool(
  actorId: string,
  name: string,
  input: unknown,
  sourceMessageId?: string,
  options: { rawProductHelpForServerModel?: boolean } = {},
): Promise<unknown> {
  const serviceClient = createServiceRoleClient();
  const role = await accountRole(serviceClient, actorId);
  return executeAuthorizedAction(
    serviceClient,
    actorId,
    role,
    name,
    input,
    sourceMessageId,
    options.rawProductHelpForServerModel,
  );
}
