import { createError, defineEventHandler, getHeader, getQuery, readRawBody } from "nitro/h3";
import { start } from "workflow/api";
import { createAuthenticatedServerClient, createServiceRoleClient } from "../src/lib/server-supabase";
import {
  GEMINI_TTS_CACHE_BUCKET,
  GEMINI_TTS_CACHE_RETENTION_MS,
  isGeminiTtsVoice,
} from "../src/lib/gemini-tts";
import { expireGeminiTtsAudioCache } from "../workflows/expire-gemini-tts-audio-cache";

const MAX_TTS_AUDIO_BYTES = 20 * 1024 * 1024;

function getUuid(value: string | undefined): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

export default defineEventHandler(async (event) => {
  const accessToken = getHeader(event, "authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) {
    throw createError({ statusCode: 401, statusMessage: "Sign in before saving generated speech." });
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
  const messageId = typeof query.id === "string" ? query.id : undefined;
  const versionNumber = typeof query.versionNumber === "string"
    ? Number(query.versionNumber)
    : Number.NaN;
  const voice = typeof query.voice === "string" ? query.voice : undefined;
  if (!getUuid(messageId)) {
    throw createError({ statusCode: 400, statusMessage: "The cached speech message ID is invalid." });
  }
  if (!Number.isInteger(versionNumber) || versionNumber < 1) {
    throw createError({ statusCode: 400, statusMessage: "The cached speech version number is invalid." });
  }
  if (!voice || !isGeminiTtsVoice(voice)) {
    throw createError({ statusCode: 400, statusMessage: "The cached speech voice is invalid." });
  }

  if (getHeader(event, "x-gemini-tts-source") !== "gemini") {
    throw createError({ statusCode: 400, statusMessage: "Only Gemini TTS audio can be cached." });
  }
  const audioBytes = await readRawBody(event, false);
  if (!audioBytes?.byteLength || audioBytes.byteLength > MAX_TTS_AUDIO_BYTES) {
    throw createError({ statusCode: 413, statusMessage: "The generated audio is empty or too large to cache." });
  }

  const serviceClient = createServiceRoleClient();
  const { data: version, error: versionError } = await serviceClient
    .from("chat_message_versions")
    .select("message_id")
    .eq("user_id", user.id)
    .eq("message_id", messageId)
    .eq("version_number", versionNumber)
    .maybeSingle();
  if (versionError) {
    throw createError({
      statusCode: 500,
      statusMessage: `Could not verify the message version: ${versionError.message}`,
    });
  }
  if (!version) {
    throw createError({ statusCode: 404, statusMessage: "The message version was not found." });
  }
  const { data: message, error: messageError } = await serviceClient
    .from("chat_messages")
    .select("role")
    .eq("user_id", user.id)
    .eq("id", messageId)
    .maybeSingle();
  if (messageError) {
    throw createError({
      statusCode: 500,
      statusMessage: `Could not verify the chat message: ${messageError.message}`,
    });
  }
  if (message?.role !== "assistant") {
    throw createError({ statusCode: 400, statusMessage: "Speech cache can only be saved for assistant messages." });
  }

  const { data: expired, error: expiredError } = await serviceClient
    .from("chat_tts_audio_cache")
    .select("id, storage_path")
    .eq("user_id", user.id)
    .eq("message_id", messageId)
    .eq("version_number", versionNumber)
    .eq("voice", voice)
    .lte("expires_at", new Date().toISOString());
  if (expiredError) {
    throw createError({
      statusCode: 500,
      statusMessage: `Could not check expired cached speech: ${expiredError.message}`,
    });
  }
  if (expired?.length) {
    const expiredPaths = expired
      .map((item) => item.storage_path)
      .filter((path): path is string => typeof path === "string");
    if (expiredPaths.length > 0) {
      const { error: storageError } = await serviceClient.storage
        .from(GEMINI_TTS_CACHE_BUCKET)
        .remove(expiredPaths);
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
      .in("id", expired.map((item) => item.id))
      .eq("user_id", user.id);
    if (deleteError) {
      throw createError({
        statusCode: 500,
        statusMessage: `Could not remove expired speech metadata: ${deleteError.message}`,
      });
    }
  }

  const { data: existing, error: existingError } = await serviceClient
    .from("chat_tts_audio_cache")
    .select("id, storage_path, expires_at")
    .eq("user_id", user.id)
    .eq("message_id", messageId)
    .eq("version_number", versionNumber)
    .eq("voice", voice)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (existingError) {
    throw createError({
      statusCode: 500,
      statusMessage: `Could not check for existing cached speech: ${existingError.message}`,
    });
  }
  if (existing) {
    return {
      cached: true,
      expiresAt: existing.expires_at,
      cleanupScheduled: true,
      source: "gemini",
    };
  }

  const cacheId = crypto.randomUUID();
  const storagePath = `${user.id}/${messageId}/${versionNumber}/${voice}/${cacheId}.wav`;
  const { error: uploadError } = await serviceClient.storage
    .from(GEMINI_TTS_CACHE_BUCKET)
    .upload(storagePath, audioBytes, { contentType: "audio/wav", upsert: false });
  if (uploadError) {
    throw createError({
      statusCode: 502,
      statusMessage: `Could not store generated speech: ${uploadError.message}`,
    });
  }

  const expiresAt = new Date(Date.now() + GEMINI_TTS_CACHE_RETENTION_MS).toISOString();
  const { error: insertError } = await serviceClient.from("chat_tts_audio_cache").insert({
    id: cacheId,
    user_id: user.id,
    message_id: messageId,
    version_number: versionNumber,
    voice,
    storage_path: storagePath,
    source: "gemini",
    expires_at: expiresAt,
  });
  if (insertError) {
    const { error: cleanupError } = await serviceClient.storage
      .from(GEMINI_TTS_CACHE_BUCKET)
      .remove([storagePath]);
    const { data: racedCache, error: racedCacheError } = await serviceClient
      .from("chat_tts_audio_cache")
      .select("expires_at")
      .eq("user_id", user.id)
      .eq("message_id", messageId)
      .eq("version_number", versionNumber)
      .eq("voice", voice)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (!racedCacheError && racedCache) {
      return {
        cached: true,
        expiresAt: racedCache.expires_at,
        cleanupScheduled: true,
        source: "gemini",
      };
    }
    throw createError({
      statusCode: 500,
      statusMessage: `Could not save generated speech metadata: ${insertError.message}${
        cleanupError && "message" in cleanupError
          ? ` Storage cleanup also failed: ${cleanupError.message}`
          : racedCacheError
            ? ` Could not confirm a concurrent cache write: ${racedCacheError.message}`
            : ""
      }`,
    });
  }

  try {
    await start(expireGeminiTtsAudioCache, [cacheId]);
  } catch (error) {
    console.error(
      `Could not schedule automatic cleanup for TTS cache ${cacheId}; the cache remains available until it expires.`,
      error,
    );
    return { cached: true, expiresAt, cleanupScheduled: false, source: "gemini" };
  }
  return { cached: true, expiresAt, cleanupScheduled: true, source: "gemini" };
});
