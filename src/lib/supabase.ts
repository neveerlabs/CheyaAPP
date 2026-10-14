import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const DATABASE_CONFIG_KEY = "cheyaverse.supabase.bootstrap";
export const GEMINI_MODELS = [
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash-lite",
] as const;

export type GeminiModel = (typeof GEMINI_MODELS)[number];
export type ApiStatus = "untested" | "active" | "error";

export interface DatabaseConfig {
  url: string;
  publishableKey: string;
}

type AccountDataSnapshot = {
  user_settings: Database["public"]["Tables"]["user_settings"]["Row"] | null;
  ai_api_keys: Database["public"]["Tables"]["ai_api_keys"]["Row"][];
  chat_messages: Database["public"]["Tables"]["chat_messages"]["Row"][];
  chat_message_versions: Database["public"]["Tables"]["chat_message_versions"]["Row"][];
  message_insights: Database["public"]["Tables"]["message_insights"]["Row"][];
  user_memories: Database["public"]["Tables"]["user_memories"]["Row"][];
  message_feedback: Database["public"]["Tables"]["message_feedback"]["Row"][];
};

type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type ChatJobStatus = "queued" | "processing" | "completed" | "failed";

export type ChatMessageJob = {
  id: string;
  user_id: string;
  message_id: string;
  assistant_message_id: string | null;
  thinking_mode: boolean;
  status: ChatJobStatus;
  progress: string;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export interface PersonalizationSettings {
  display_name: string;
  custom_prompt: string;
  chat_style: string;
}

export const DEFAULT_PERSONALIZATION: PersonalizationSettings = {
  display_name: "",
  custom_prompt: "",
  chat_style: "",
};

export type GeminiApiKey = {
  id: string;
  model: GeminiModel;
  api_key: string;
  status: ApiStatus;
  last_error: string | null;
  created_at: string;
}

export type StoredChatMessage = {
  id: string;
  user_id: string;
  role: "user" | "assistant";
  content: string;
  embedding: string | null;
  created_at: string;
  version_number: number;
  thinking_summary: string | null;
  is_active: boolean;
  revision_reason: ChatMessageVersion["revision_reason"];
};

export type ChatMessageVersion = {
  id: string;
  user_id: string;
  message_id: string;
  version_number: number;
  content: string;
  embedding: string | null;
  thinking_summary: string | null;
  revision_reason: "initial" | "user_edit" | "regenerate" | "ai_update";
  created_at: string;
};

export type MessageInsight = {
  id: string;
  user_id: string;
  message_id: string;
  mood: string;
  communication_style: string;
  situation: string;
  topics: string[];
  support_needs: string;
  summary: string;
  created_at: string;
};

export type UserMemory = {
  id: string;
  user_id: string;
  source_message_id: string | null;
  category: string;
  content: string;
  embedding: string | null;
  created_at: string;
  updated_at: string;
};

export type MessageFeedback = {
  id: string;
  user_id: string;
  message_id: string;
  version_number: number;
  kind: "like" | "dislike" | "report";
  details: string | null;
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      ai_api_keys: {
        Row: GeminiApiKey & {
          user_id: string;
          provider: "gemini";
        };
        Insert: {
          id?: string;
          user_id?: string;
          provider?: "gemini";
          model: GeminiModel;
          api_key: string;
          status?: ApiStatus;
          last_error?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          provider: "gemini";
          model: GeminiModel;
          api_key: string;
          status: ApiStatus;
          last_error: string | null;
        }>;
        Relationships: never[];
      };
      user_settings: {
        Row: {
          user_id: string;
          supabase_url: string;
          publishable_key: string;
          display_name: string;
          custom_prompt: string;
          chat_style: string;
          updated_at: string;
        };
        Insert: {
          user_id?: string;
          supabase_url?: string;
          publishable_key?: string;
          display_name?: string;
          custom_prompt?: string;
          chat_style?: string;
          updated_at?: string;
        };
        Update: Partial<{
          supabase_url: string;
          publishable_key: string;
          display_name: string;
          custom_prompt: string;
          chat_style: string;
          updated_at: string;
        }>;
        Relationships: never[];
      };
      chat_messages: {
        Row: StoredChatMessage;
        Insert: {
          id?: string;
          user_id?: string;
          role: StoredChatMessage["role"];
          content: string;
          embedding?: string | null;
          created_at?: string;
          version_number?: number;
          thinking_summary?: string | null;
          is_active?: boolean;
          revision_reason?: ChatMessageVersion["revision_reason"];
        };
        Update: Partial<{
          role: StoredChatMessage["role"];
          content: string;
          embedding: string | null;
          version_number: number;
          thinking_summary: string | null;
          is_active: boolean;
          revision_reason: ChatMessageVersion["revision_reason"];
        }>;
        Relationships: never[];
      };
      chat_message_versions: {
        Row: ChatMessageVersion;
        Insert: {
          id?: string;
          user_id?: string;
          message_id: string;
          version_number: number;
          content: string;
          embedding?: string | null;
          thinking_summary?: string | null;
          revision_reason: ChatMessageVersion["revision_reason"];
          created_at?: string;
        };
        Update: Partial<{
          embedding: string | null;
        }>;
        Relationships: never[];
      };
      chat_conversation_branches: {
        Row: {
          id: string;
          user_id: string;
          anchor_message_id: string;
          anchor_version_number: number;
          messages: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string;
          anchor_message_id: string;
          anchor_version_number: number;
          messages: Json;
          created_at?: string;
        };
        Update: Partial<{
          messages: Json;
        }>;
        Relationships: never[];
      };
      chat_message_jobs: {
        Row: ChatMessageJob;
        Insert: {
          id?: string;
          user_id?: string;
          message_id: string;
          assistant_message_id?: string | null;
          thinking_mode?: boolean;
          status?: ChatJobStatus;
          progress?: string;
          error?: string | null;
          created_at?: string;
          updated_at?: string;
          completed_at?: string | null;
        };
        Update: Partial<{
          assistant_message_id: string | null;
          status: ChatJobStatus;
          progress: string;
          error: string | null;
          updated_at: string;
          completed_at: string | null;
        }>;
        Relationships: never[];
      };
      message_insights: {
        Row: MessageInsight;
        Insert: {
          id?: string;
          user_id?: string;
          message_id: string;
          mood?: string;
          communication_style?: string;
          situation?: string;
          topics?: string[];
          support_needs?: string;
          summary?: string;
          created_at?: string;
        };
        Update: Partial<{
          mood: string;
          communication_style: string;
          situation: string;
          topics: string[];
          support_needs: string;
          summary: string;
        }>;
        Relationships: never[];
      };
      user_memories: {
        Row: UserMemory;
        Insert: {
          id?: string;
          user_id?: string;
          source_message_id?: string | null;
          category?: string;
          content: string;
          embedding?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<{
          category: string;
          content: string;
          source_message_id: string | null;
          embedding: string | null;
          updated_at: string;
        }>;
        Relationships: never[];
      };
      message_feedback: {
        Row: MessageFeedback;
        Insert: {
          id?: string;
          user_id?: string;
          message_id: string;
          version_number?: number;
          kind: MessageFeedback["kind"];
          details?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          kind: MessageFeedback["kind"];
          details: string | null;
        }>;
        Relationships: never[];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      import_account_data: {
        Args: { p_data: Json };
        Returns: {
          imported: number;
        }[];
      };
      set_message_rating: {
        Args: {
          p_message_id: string;
          p_version_number: number;
          p_rating: "like" | "dislike" | null;
        };
        Returns: undefined;
      };
      delete_chat_branch_from_message: {
        Args: { p_message_id: string };
        Returns: number;
      };
      run_database_keepalive: {
        Args: Record<PropertyKey, never>;
        Returns: Array<{
          pinged: boolean;
          idle_days: number;
          last_activity_at: string;
          last_keepalive_at: string | null;
        }>;
      };
      revise_chat_message: {
        Args: {
          p_message_id: string;
          p_content: string;
          p_embedding: string | null;
          p_thinking_summary: string | null;
          p_revision_reason: ChatMessageVersion["revision_reason"];
          p_branch: boolean;
        };
        Returns: StoredChatMessage[];
      };
      restore_chat_branch: {
        Args: {
          p_anchor_message_id: string;
          p_anchor_version_number: number;
        };
        Returns: StoredChatMessage[];
      };
      save_chat_branch: {
        Args: {
          p_anchor_message_id: string;
          p_anchor_version_number: number;
        };
        Returns: undefined;
      };
      create_chat_job: {
        Args: { p_content: string; p_thinking_mode: boolean };
        Returns: Array<{ job_id: string; message_id: string }>;
      };
      complete_chat_job: {
        Args: {
          p_job_id: string;
          p_content: string;
          p_embedding: string | null;
          p_thinking_summary: string | null;
        };
        Returns: StoredChatMessage[];
      };
      match_chat_messages_for_user: {
        Args: {
          p_user_id: string;
          query_embedding: string;
          result_limit?: number;
          exclude_message_id?: string | null;
        };
        Returns: Array<{
          id: string;
          role: StoredChatMessage["role"];
          content: string;
          created_at: string;
          similarity: number;
        }>;
      };
      match_chat_messages_before_for_user: {
        Args: {
          p_user_id: string;
          query_embedding: string;
          max_created_at: string;
          result_limit?: number;
          exclude_message_id?: string | null;
        };
        Returns: Array<{
          id: string;
          role: StoredChatMessage["role"];
          content: string;
          created_at: string;
          similarity: number;
        }>;
      };
      match_user_memories_for_user: {
        Args: {
          p_user_id: string;
          query_embedding: string;
          result_limit?: number;
        };
        Returns: Array<{
          id: string;
          category: string;
          content: string;
          similarity: number;
        }>;
      };
      match_chat_messages: {
        Args: {
          query_embedding: string;
          result_limit?: number;
          exclude_message_id?: string | null;
        };
        Returns: Array<{
          id: string;
          role: StoredChatMessage["role"];
          content: string;
          created_at: string;
          similarity: number;
        }>;
      };
      match_chat_messages_before: {
        Args: {
          query_embedding: string;
          max_created_at: string;
          result_limit?: number;
          exclude_message_id?: string | null;
        };
        Returns: Array<{
          id: string;
          role: StoredChatMessage["role"];
          content: string;
          created_at: string;
          similarity: number;
        }>;
      };
      match_user_memories: {
        Args: { query_embedding: string; result_limit?: number };
        Returns: Array<{
          id: string;
          category: string;
          content: string;
          similarity: number;
        }>;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

export type AppSupabaseClient = SupabaseClient<Database, "public">;

const clients = new Map<string, AppSupabaseClient>();
const pendingSessions = new WeakMap<AppSupabaseClient, Promise<void>>();
const pendingImports = new WeakMap<AppSupabaseClient, Promise<void>>();
const ACCOUNT_MIGRATION_DB = "cheyaverse-account-migration";
const ACCOUNT_MIGRATION_STORE = "snapshots";
const ACCOUNT_MIGRATION_KEY = "pending";
const ACCOUNT_MIGRATION_MARKER = "cheyaverse.account-migration.pending";

function openMigrationStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(ACCOUNT_MIGRATION_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(ACCOUNT_MIGRATION_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open account migration storage."));
  });
}

async function readMigrationSnapshot(): Promise<AccountDataSnapshot | null> {
  if (!window.localStorage.getItem(ACCOUNT_MIGRATION_MARKER)) return null;
  const db = await openMigrationStore();
  return new Promise((resolve, reject) => {
    const request = db
      .transaction(ACCOUNT_MIGRATION_STORE, "readonly")
      .objectStore(ACCOUNT_MIGRATION_STORE)
      .get(ACCOUNT_MIGRATION_KEY);
    request.onsuccess = () => {
      db.close();
      const snapshot = (request.result as AccountDataSnapshot | undefined) ?? null;
      if (!snapshot) window.localStorage.removeItem(ACCOUNT_MIGRATION_MARKER);
      resolve(snapshot);
    };
    request.onerror = () => {
      db.close();
      reject(request.error ?? new Error("Could not read saved account migration data."));
    };
  });
}

async function writeMigrationSnapshot(snapshot: AccountDataSnapshot | null): Promise<void> {
  const db = await openMigrationStore();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(ACCOUNT_MIGRATION_STORE, "readwrite");
    const store = transaction.objectStore(ACCOUNT_MIGRATION_STORE);
    if (snapshot) store.put(snapshot, ACCOUNT_MIGRATION_KEY);
    else store.delete(ACCOUNT_MIGRATION_KEY);
    transaction.oncomplete = () => {
      try {
        if (snapshot) window.localStorage.setItem(ACCOUNT_MIGRATION_MARKER, "1");
        else window.localStorage.removeItem(ACCOUNT_MIGRATION_MARKER);
        resolve();
      } catch (error) {
        reject(
          new Error(
            `Could not update account migration status: ${
              error instanceof Error ? error.message : "browser storage is unavailable."
            }`,
          ),
        );
      }
    };
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Could not save account migration data."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Account migration storage was interrupted."));
  }).finally(() => db.close());
}

function mergeAccountSnapshots(
  previous: AccountDataSnapshot | null,
  current: AccountDataSnapshot,
): AccountDataSnapshot {
  if (!previous) return current;
  const mergeById = <T extends { id: string }>(oldRows: T[], newRows: T[]) =>
    [...new Map([...oldRows, ...newRows].map((row) => [row.id, row])).values()];
  const settings = [previous.user_settings, current.user_settings]
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((left, right) => left.updated_at.localeCompare(right.updated_at))
    .slice(-1)[0] ?? null;
  return {
    user_settings: settings,
    ai_api_keys: mergeById(previous.ai_api_keys, current.ai_api_keys),
    chat_messages: mergeById(previous.chat_messages, current.chat_messages),
    chat_message_versions: mergeById(
      previous.chat_message_versions,
      current.chat_message_versions,
    ),
    message_insights: mergeById(previous.message_insights, current.message_insights),
    user_memories: mergeById(previous.user_memories, current.user_memories),
    message_feedback: mergeById(previous.message_feedback, current.message_feedback),
  };
}

async function loadAllRows<T>(
  loadPage: (
    start: number,
    end: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await loadPage(start, start + 999);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

async function exportAccountData(client: AppSupabaseClient): Promise<AccountDataSnapshot> {
  const [
    settingsResult,
    aiApiKeys,
    chatMessages,
    chatMessageVersions,
    messageInsights,
    userMemories,
    messageFeedback,
  ] = await Promise.all([
    client.from("user_settings").select("*").maybeSingle(),
    loadAllRows((start, end) =>
      client.from("ai_api_keys").select("*").order("id").range(start, end),
    ),
    loadAllRows((start, end) =>
      client.from("chat_messages").select("*").order("id").range(start, end),
    ),
    loadAllRows((start, end) =>
      client.from("chat_message_versions").select("*").order("id").range(start, end),
    ),
    loadAllRows((start, end) =>
      client.from("message_insights").select("*").order("id").range(start, end),
    ),
    loadAllRows((start, end) =>
      client.from("user_memories").select("*").order("id").range(start, end),
    ),
    loadAllRows((start, end) =>
      client.from("message_feedback").select("*").order("id").range(start, end),
    ),
  ]);
  if (settingsResult.error) {
    throw new Error(`Could not export account settings: ${settingsResult.error.message}`);
  }
  return {
    user_settings: settingsResult.data,
    ai_api_keys: aiApiKeys,
    chat_messages: chatMessages,
    chat_message_versions: chatMessageVersions,
    message_insights: messageInsights,
    user_memories: userMemories,
    message_feedback: messageFeedback,
  };
}

async function importAccountSnapshot(
  client: AppSupabaseClient,
  snapshot: AccountDataSnapshot,
): Promise<void> {
  const emptySnapshot: AccountDataSnapshot = {
    user_settings: null,
    ai_api_keys: [],
    chat_messages: [],
    chat_message_versions: [],
    message_insights: [],
    user_memories: [],
    message_feedback: [],
  };
  const importChunk = async (data: AccountDataSnapshot) => {
    const { error } = await client.rpc("import_account_data", { p_data: data });
    if (error) throw error;
  };

  await importChunk({
    ...emptySnapshot,
    user_settings: snapshot.user_settings
      ? { ...snapshot.user_settings, supabase_url: "", publishable_key: "" }
      : null,
    ai_api_keys: snapshot.ai_api_keys,
  });
  const chunkSize = 100;
  const importRows = async <K extends Exclude<keyof AccountDataSnapshot, "user_settings">>(
    key: K,
    rows: AccountDataSnapshot[K],
  ) => {
    for (let start = 0; start < rows.length; start += chunkSize) {
      await importChunk({
        ...emptySnapshot,
        [key]: rows.slice(start, start + chunkSize),
      });
    }
  };
  await importRows("user_memories", snapshot.user_memories);
  await importRows("chat_messages", snapshot.chat_messages);
  await importRows("chat_message_versions", snapshot.chat_message_versions);
  await importRows("message_insights", snapshot.message_insights);
  await importRows("message_feedback", snapshot.message_feedback);
}

async function importPendingAccountData(client: AppSupabaseClient): Promise<void> {
  const pendingImport = pendingImports.get(client);
  if (pendingImport) return pendingImport;

  const importAttempt = (async () => {
    const snapshot = await readMigrationSnapshot();
    if (!snapshot) return;
    const { data, error } = await client.auth.getUser();
    if (error) throw error;
    if (!data.user || data.user.is_anonymous) return;

    try {
      await importAccountSnapshot(client, snapshot);
    } catch (error) {
      throw new Error(
        `Your Google account is connected, but existing browser data could not be imported. Run the latest supabase/schema.sql and retry. ${
          error instanceof Error ? error.message : "Unknown database error."
        }`,
      );
    }
    await writeMigrationSnapshot(null);
    window.localStorage.removeItem(DATABASE_CONFIG_KEY);
  })();

  pendingImports.set(client, importAttempt);
  return importAttempt.finally(() => {
    pendingImports.delete(client);
  });
}

export async function signInWithGoogle(
  client: AppSupabaseClient,
  googleIdToken: string,
  captchaToken: string,
): Promise<void> {
  const legacyConfig = loadLegacyDatabaseConfig();
  if (legacyConfig) {
    const legacyClient = createSupabaseClient(legacyConfig);
    await ensureAnonymousSession(legacyClient);
    const exported = await exportAccountData(legacyClient);
    const previous = await readMigrationSnapshot();
    await writeMigrationSnapshot(mergeAccountSnapshots(previous, exported));
  }

  const { error } = await client.auth.signInWithIdToken({
    provider: "google",
    token: googleIdToken,
    options: { captchaToken },
  });
  if (error) throw error;

  try {
    await importPendingAccountData(client);
  } catch (importError) {
    const { error: signOutError } = await client.auth.signOut({ scope: "local" });
    if (signOutError) {
      throw new Error(
        `Existing data could not be imported, and sign-out failed: ${
          importError instanceof Error ? importError.message : "Unknown import error."
        } ${signOutError.message}`,
      );
    }
    throw importError;
  }
}

export function loadDatabaseConfig(): DatabaseConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const publishableKey =
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  return url && publishableKey ? { url, publishableKey } : null;
}

function loadLegacyDatabaseConfig(): DatabaseConfig | null {
  const stored = window.localStorage.getItem(DATABASE_CONFIG_KEY);
  if (!stored) return null;
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    throw new Error("The old browser database settings are invalid; they could not be migrated.");
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !("url" in value) ||
    !("publishableKey" in value) ||
    typeof value.url !== "string" ||
    typeof value.publishableKey !== "string" ||
    !value.url ||
    !value.publishableKey
  ) {
    throw new Error("The old browser database settings are incomplete; they could not be migrated.");
  }
  return { url: value.url, publishableKey: value.publishableKey };
}

export function createSupabaseClient(config: DatabaseConfig): AppSupabaseClient {
  const cacheKey = JSON.stringify([config.url, config.publishableKey]);
  const cachedClient = clients.get(cacheKey);
  if (cachedClient) return cachedClient;

  const client = createClient<Database, "public">(config.url, config.publishableKey);
  clients.set(cacheKey, client);
  return client;
}

export function ensureSupabaseSession(client: AppSupabaseClient): Promise<void> {
  const pendingSession = pendingSessions.get(client);
  if (pendingSession) return pendingSession;

  const sessionAttempt = (async () => {
    const {
      data: { session },
      error: sessionError,
    } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    if (!session?.user || session.user.is_anonymous) {
      throw new Error("Sign in with your Google account before using CheyaVerse.");
    }
    await importPendingAccountData(client);
  })();

  pendingSessions.set(client, sessionAttempt);
  return sessionAttempt.finally(() => {
    pendingSessions.delete(client);
  });
}

async function ensureAnonymousSession(client: AppSupabaseClient): Promise<void> {
  const {
    data: { session },
    error: sessionError,
  } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  if (session) return;
  const { error } = await client.auth.signInAnonymously();
  if (error) {
    throw new Error(
      `Could not read the previous browser database for migration: ${error.message}`,
    );
  }
}

export async function saveApiStatus(
  client: AppSupabaseClient,
  attempt: { keyId: string; status: Exclude<ApiStatus, "untested">; error: string | null },
  userId?: string,
): Promise<void> {
  let query = client
    .from("ai_api_keys")
    .update({
      status: attempt.status,
      last_error: attempt.error,
    })
    .eq("id", attempt.keyId);
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query.select("id");

  if (error) throw error;
  if (data.length === 0) {
    throw new Error("Could not update the API status. Check your database table and RLS policies.");
  }
}
