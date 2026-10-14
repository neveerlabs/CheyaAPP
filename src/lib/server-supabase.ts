import { createClient } from "@supabase/supabase-js";
import type { AppSupabaseClient, Database } from "./supabase";

type RuntimeGlobal = typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
};

function requiredEnv(name: string, fallbackName?: string): string {
  const env = (globalThis as RuntimeGlobal).process?.env;
  const value = env?.[name]?.trim() || (fallbackName ? env?.[fallbackName]?.trim() : "");
  if (!value) throw new Error(`Missing server environment variable ${name}.`);
  return value;
}

function databaseUrl(): string {
  return requiredEnv("SUPABASE_URL", "VITE_SUPABASE_URL");
}

function publishableKey(): string {
  return requiredEnv("SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY");
}

export function createAuthenticatedServerClient(accessToken: string): AppSupabaseClient {
  return createClient<Database, "public">(databaseUrl(), publishableKey(), {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
}

export function createServiceRoleClient(): AppSupabaseClient {
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient<Database, "public">(databaseUrl(), serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
