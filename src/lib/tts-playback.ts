import {
  DEFAULT_GEMINI_TTS_VOICE,
  generateGeminiSpeech,
  isGeminiTtsVoice,
  type GeminiTtsVoice,
} from "./gemini-tts";
import type { AppSupabaseClient } from "./supabase";

type SpeechPreparation = {
  audio: Blob | null;
  voice: GeminiTtsVoice;
  browserVoiceName?: string;
  errors: string[];
};

type CachedSpeech = {
  audio: Blob;
};

const inMemorySpeechCache = new Map<string, CachedSpeech>();
const MAX_IN_MEMORY_SPEECH_CACHE_ENTRIES = 8;

function speechCacheKey(messageId: string, versionNumber: number, voice: GeminiTtsVoice): string {
  return `${messageId}:${versionNumber}:${voice}`;
}

function rememberSpeech(key: string, speech: CachedSpeech): void {
  inMemorySpeechCache.delete(key);
  inMemorySpeechCache.set(key, speech);
  if (inMemorySpeechCache.size > MAX_IN_MEMORY_SPEECH_CACHE_ENTRIES) {
    const oldestKey = inMemorySpeechCache.keys().next().value;
    if (oldestKey) inMemorySpeechCache.delete(oldestKey);
  }
}

function responseErrorMessage(body: string, fallback: string): string {
  try {
    const payload: unknown = JSON.parse(body);
    if (typeof payload === "object" && payload !== null) {
      if ("statusMessage" in payload && typeof payload.statusMessage === "string") {
        return payload.statusMessage;
      }
      if ("message" in payload && typeof payload.message === "string") {
        return payload.message;
      }
    }
  } catch {
    if (body.trim()) return body;
  }
  return fallback;
}

async function getCachedAudio(
  cacheUrl: URL,
  authorization: string,
  signal: AbortSignal,
): Promise<CachedSpeech | null> {
  const response = await fetch(cacheUrl, {
    headers: { Authorization: authorization },
    signal,
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      responseErrorMessage(body, `Could not check saved speech (HTTP ${response.status}).`),
    );
  }

  const payload: unknown = await response.json();
  const signedUrl =
    typeof payload === "object" &&
    payload !== null &&
    "signedUrl" in payload &&
    typeof payload.signedUrl === "string"
      ? payload.signedUrl
      : null;
  if (!signedUrl) throw new Error("The speech cache returned an invalid audio link.");
  const audioResponse = await fetch(signedUrl, { signal });
  if (!audioResponse.ok) {
    throw new Error(`Could not download saved speech (HTTP ${audioResponse.status}).`);
  }
  const audio = await audioResponse.blob();
  if (!audio.size) throw new Error("The speech cache returned an empty audio file.");
  return { audio };
}

export async function prepareAssistantSpeech(
  client: AppSupabaseClient | null,
  messageId: string,
  versionNumber: number,
  text: string,
  signal: AbortSignal,
): Promise<SpeechPreparation> {
  const errors: string[] = [];
  let voice = DEFAULT_GEMINI_TTS_VOICE;
  let apiKeys: string[] = [];
  let authorization: string | null = null;

  if (client) {
    try {
      const { data: settings, error } = await client
        .from("user_settings")
        .select("tts_api_key, tts_api_keys, tts_voice")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (settings) {
        const savedKeys = Array.isArray(settings.tts_api_keys)
          ? settings.tts_api_keys.filter(
              (key): key is string => typeof key === "string" && Boolean(key.trim()),
            )
          : [];
        apiKeys = savedKeys.length
          ? savedKeys
          : settings.tts_api_key.trim()
            ? [settings.tts_api_key]
            : [];
        if (isGeminiTtsVoice(settings.tts_voice)) voice = settings.tts_voice;
      }
    } catch (error) {
      errors.push(
        `Could not load saved Gemini TTS settings: ${
          error instanceof Error ? error.message : "Unknown account settings error."
        }`,
      );
    }

    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw new Error(error.message);
      const accessToken = data.session?.access_token;
      if (accessToken) authorization = `Bearer ${accessToken}`;
    } catch (error) {
      errors.push(
        `Could not read the account session: ${
          error instanceof Error ? error.message : "Unknown session error."
        }`,
      );
    }
  }

  const cacheUrl = new URL("/api/tts-audio-cache", window.location.origin);
  cacheUrl.searchParams.set("messageId", messageId);
  cacheUrl.searchParams.set("versionNumber", String(versionNumber));
  cacheUrl.searchParams.set("voice", voice);

  if (!authorization) {
    errors.push("Sign in is required to check or save generated speech.");
    return { audio: null, voice, errors };
  }

  const memoryCached = inMemorySpeechCache.get(speechCacheKey(messageId, versionNumber, voice));
  if (memoryCached) return { audio: memoryCached.audio, voice, errors };

  try {
    const cached = await getCachedAudio(cacheUrl, authorization, signal);
    if (cached) {
      rememberSpeech(speechCacheKey(messageId, versionNumber, voice), cached);
      return { audio: cached.audio, voice, errors };
    }
  } catch (error) {
    if (signal.aborted) throw error;
    errors.push(
      `Saved audio could not be checked, so Gemini was not called: ${
        error instanceof Error ? error.message : "Unknown cache read error."
      }`,
    );
    return { audio: null, voice, errors };
  }

  let audio: Blob | null = null;
  if (apiKeys.length > 0) {
    try {
      audio = await generateGeminiSpeech(apiKeys, text, voice, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      errors.push(
        error instanceof Error ? error.message : "All configured Gemini TTS keys failed.",
      );
    }
  }

  if (!audio) return { audio: null, voice, errors };

  try {
    const postUrl = new URL("/api/tts-audio-cache", window.location.origin);
    postUrl.searchParams.set("id", messageId);
    postUrl.searchParams.set("versionNumber", String(versionNumber));
    postUrl.searchParams.set("voice", voice);
    const response = await fetch(postUrl, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "audio/wav",
        "X-Gemini-TTS-Source": "gemini",
      },
      body: audio,
      signal,
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        responseErrorMessage(body, `Cache storage returned HTTP ${response.status}.`),
      );
    }
    const result: unknown = await response.json();
    if (
      typeof result !== "object" ||
      result === null ||
      !("cached" in result) ||
      result.cached !== true
    ) {
      throw new Error("The cache endpoint did not confirm that the audio was saved.");
    }

    const verified = await getCachedAudio(cacheUrl, authorization, signal);
    if (!verified?.audio) throw new Error("Saved audio could not be found after the upload.");
    audio = verified.audio;
  } catch (error) {
    if (signal.aborted) throw error;
    errors.push(
      `Generated audio could not be saved for replay: ${
        error instanceof Error ? error.message : "Unknown cache storage error."
      }`,
    );
    console.error(
      `Generated speech for message ${messageId} version ${versionNumber} could not be cached for 24 hours.`,
      error,
    );
  }

  rememberSpeech(speechCacheKey(messageId, versionNumber, voice), { audio });
  return { audio, voice, errors };
}
