import { sleep } from "workflow";
import { createServiceRoleClient } from "../src/lib/server-supabase";
import { GEMINI_TTS_CACHE_BUCKET } from "../src/lib/gemini-tts";

async function loadCacheExpiry(cacheId: string): Promise<{
  expiresAt: string;
  userId: string;
  storagePath: string | null;
} | null> {
  "use step";
  const client = createServiceRoleClient();
  const { data, error } = await client
    .from("chat_tts_audio_cache")
    .select("expires_at, user_id, storage_path")
    .eq("id", cacheId)
    .maybeSingle();
  if (error) throw new Error(`Could not load TTS cache expiry: ${error.message}`);
  if (!data) return null;
  return {
    expiresAt: data.expires_at,
    userId: data.user_id,
    storagePath: data.storage_path,
  };
}

async function deleteExpiredCache(
  cacheId: string,
  userId: string,
  storagePath: string | null,
): Promise<void> {
  "use step";
  const client = createServiceRoleClient();
  const { data: cache, error: cacheError } = await client
    .from("chat_tts_audio_cache")
    .select("id")
    .eq("id", cacheId)
    .eq("user_id", userId)
    .lte("expires_at", new Date().toISOString())
    .maybeSingle();
  if (cacheError) throw new Error(`Could not verify expired TTS cache: ${cacheError.message}`);
  if (!cache) return;

  if (storagePath) {
    const { error: storageError } = await client.storage
      .from(GEMINI_TTS_CACHE_BUCKET)
      .remove([storagePath]);
    if (storageError) throw new Error(`Could not delete expired TTS audio: ${storageError.message}`);
  }
  const { error } = await client
    .from("chat_tts_audio_cache")
    .delete()
    .eq("id", cacheId)
    .eq("user_id", userId);
  if (error) throw new Error(`Could not delete expired TTS cache metadata: ${error.message}`);
}

export async function expireGeminiTtsAudioCache(cacheId: string): Promise<void> {
  "use workflow";
  const cache = await loadCacheExpiry(cacheId);
  if (!cache) return;
  await sleep(new Date(cache.expiresAt));
  await deleteExpiredCache(cacheId, cache.userId, cache.storagePath);
}
