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

export type GeminiApiKey = {
  id: string;
  model: GeminiModel;
  api_key: string;
  status: ApiStatus;
  last_error: string | null;
  created_at: string;
}

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
          updated_at: string;
        };
        Insert: {
          user_id?: string;
          supabase_url: string;
          publishable_key: string;
          updated_at?: string;
        };
        Update: Partial<{
          supabase_url: string;
          publishable_key: string;
          updated_at: string;
        }>;
        Relationships: never[];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

export type AppSupabaseClient = SupabaseClient<Database, "public">;

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
  return createClient<Database, "public">(config.url, config.publishableKey);
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
