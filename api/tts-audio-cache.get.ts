import { createError, defineEventHandler, getHeader, getQuery } from "nitro/h3";
import { createAuthenticatedServerClient, createServiceRoleClient } from "../src/lib/server-supabase";
import { GEMINI_TTS_CACHE_BUCKET, isGeminiTtsVoice } from "../src/lib/gemini-tts";

function getUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

export default defineEventHandler(async (event) => {
  const accessToken = getHeader(event, "authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) {
    throw createError({ statusCode: 401, statusMessage: "Sign in before opening cached speech." });
  }
  const requestClient = createAuthenticatedServerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await requestClient.auth.getUser(accessToken);
  if (authError || !user || user.is_anonymous) {
    throw createError({ statusCode: 401, statusMessage: "Your account session is invalid or expired." });
  }

  const query = getQuery(event);
  const messageId = query.messageId;
  const versionNumber = Number(query.versionNumber);
  const voice = query.voice;
  if (
    !getUuid(messageId) ||
    !Number.isInteger(versionNumber) ||
    versionNumber < 1 ||
    typeof voice !== "string" ||
    !isGeminiTtsVoice(voice)
  ) {
    throw createError({ statusCode: 400, statusMessage: "The cached speech reference is invalid." });
  }

  const serviceClient = createServiceRoleClient();
  const { data: cache, error: cacheError } = await serviceClient
    .from("chat_tts_audio_cache")
    .select("storage_path, source, browser_voice_name, error_details, expires_at")
    .eq("user_id", user.id)
    .eq("message_id", messageId)
    .eq("version_number", versionNumber)
    .eq("voice", voice)
    .maybeSingle();
  if (cacheError) {
    throw createError({
      statusCode: 500,
      statusMessage: `Could not check cached speech: ${cacheError.message}`,
    });
  }
  if (!cache || Date.parse(cache.expires_at) <= Date.now()) {
    if (cache) {
      if (cache.storage_path) {
        const { error: storageError } = await serviceClient.storage
          .from(GEMINI_TTS_CACHE_BUCKET)
          .remove([cache.storage_path]);
        if (storageError) {
          throw createError({
            statusCode: 502,
            statusMessage: `Could not remove expired cached speech: ${storageError.message}`,
          });
        }
      }
      const { error: deleteError } = await serviceClient
        .from("chat_tts_audio_cache")
        .delete()
        .eq("user_id", user.id)
        .eq("message_id", messageId)
        .eq("version_number", versionNumber)
        .eq("voice", voice);
      if (deleteError) {
        throw createError({
          statusCode: 500,
          statusMessage: `Could not remove expired speech metadata: ${deleteError.message}`,
        });
      }
    }
    throw createError({ statusCode: 404, statusMessage: "No unexpired cached speech was found." });
  }

  if (cache.source === "browser") {
    return {
      source: "browser",
      voiceName: cache.browser_voice_name,
      errors: cache.error_details,
    };
  }
  if (!cache.storage_path) {
    throw createError({
      statusCode: 500,
      statusMessage: "The saved Gemini speech is missing its storage path.",
    });
  }
  const secondsUntilExpiry = Math.floor((Date.parse(cache.expires_at) - Date.now()) / 1000);
  const { data, error } = await serviceClient.storage
    .from(GEMINI_TTS_CACHE_BUCKET)
    .createSignedUrl(cache.storage_path, Math.max(1, Math.min(secondsUntilExpiry, 60)));
  if (error) {
    throw createError({
      statusCode: 502,
      statusMessage: `Could not open cached speech: ${error.message}`,
    });
  }
  return { signedUrl: data.signedUrl };
});
