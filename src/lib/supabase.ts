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
  category: string;
  content: string;
  created_at: string;
  updated_at: string;
};

export type MessageFeedback = {
  id: string;
  user_id: string;
  message_id: string;
  kind: "like" | "dislike" | "report";
  details: string | null;
  created_at: string;
};

type Database = {
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
          supabase_url: string;
          publishable_key: string;
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
        };
        Update: Partial<{
          role: StoredChatMessage["role"];
          content: string;
          embedding: string | null;
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
          category?: string;
          content: string;
          embedding?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<{
          category: string;
          content: string;
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

export function loadDatabaseConfig(): DatabaseConfig | null {
  const stored = window.localStorage.getItem(DATABASE_CONFIG_KEY);
  if (!stored) return null;

  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    throw new Error("The saved Supabase configuration is invalid. Enter it again.");
  }

  if (
    typeof value !== "object" ||
    value === null ||
    !("url" in value) ||
    !("publishableKey" in value) ||
    typeof value.url !== "string" ||
    typeof value.publishableKey !== "string"
  ) {
    throw new Error("The saved Supabase configuration is incomplete. Enter it again.");
  }

  return { url: value.url, publishableKey: value.publishableKey };
}

export function saveDatabaseConfig(config: DatabaseConfig): void {
  try {
    window.localStorage.setItem(DATABASE_CONFIG_KEY, JSON.stringify(config));
  } catch {
    throw new Error("Could not save the Supabase bootstrap settings in this browser.");
  }
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
    if (session) return;

    const { error } = await client.auth.signInAnonymously();
    if (error) {
      throw new Error(
        `Could not create a private database session. Enable Anonymous Sign-Ins in your Supabase Auth settings. ${error.message}`,
      );
    }
  })();

  pendingSessions.set(client, sessionAttempt);
  return sessionAttempt.finally(() => {
    pendingSessions.delete(client);
  });
}

export async function saveApiStatus(
  client: AppSupabaseClient,
  attempt: { keyId: string; status: Exclude<ApiStatus, "untested">; error: string | null },
): Promise<void> {
  const { data, error } = await client
    .from("ai_api_keys")
    .update({
      status: attempt.status,
      last_error: attempt.error,
    })
    .eq("id", attempt.keyId)
    .select("id");

  if (error) throw error;
  if (data.length === 0) {
    throw new Error("Could not update the API status. Check your database table and RLS policies.");
  }
}
