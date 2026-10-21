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
  source: "gemini" | "soundoftext" | null;
  browserVoiceName?: string;
  errors: string[];
};

type CachedSpeech = {
  audio: Blob;
};

const inMemorySpeechCache = new Map<string, CachedSpeech>();
const MAX_IN_MEMORY_SPEECH_CACHE_ENTRIES = 8;

function readableErrorText(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("<")) {
    return trimmed
      .replace(/\[([^\]]+)\]\((?:https?:\/\/[^)]+)\)/g, "$1")
      .replace(/<[^>]*>/g, "")
      .slice(0, 500)
      .trim() || fallback;
  }
  const title = trimmed.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    ?.replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return title
    ? `The server returned an HTML error page: ${title.slice(0, 240)}`
    : "The server returned an HTML error page instead of a speech response.";
}

function speechCacheKey(
  messageId: string,
  versionNumber: number,
  source: "gemini" | "soundoftext",
  voice: string,
): string {
  return `${messageId}:${versionNumber}:${source}:${voice}`;
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
        return readableErrorText(payload.statusMessage, fallback);
      }
      if ("message" in payload && typeof payload.message === "string") {
        return readableErrorText(payload.message, fallback);
      }
    }
  } catch {
    return readableErrorText(body, fallback);
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

function createCacheUrl(
  messageId: string,
  versionNumber: number,
  voice: string,
): URL {
  const cacheUrl = new URL("/api/tts-audio-cache", window.location.origin);
  cacheUrl.searchParams.set("messageId", messageId);
  cacheUrl.searchParams.set("versionNumber", String(versionNumber));
  cacheUrl.searchParams.set("voice", voice);
  return cacheUrl;
}

async function saveCachedAudio(
  audio: Blob,
  messageId: string,
  versionNumber: number,
  source: "gemini",
  sourceVoice: string,
  mimeType: "audio/wav" | "audio/mpeg",
  authorization: string,
  signal: AbortSignal,
): Promise<Blob> {
  const postUrl = new URL("/api/tts-audio-cache", window.location.origin);
  postUrl.searchParams.set("id", messageId);
  postUrl.searchParams.set("versionNumber", String(versionNumber));
  postUrl.searchParams.set("voice", sourceVoice);
  const response = await fetch(postUrl, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": mimeType,
      "X-TTS-Source": source,
    },
    body: audio,
    signal,
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(responseErrorMessage(body, `Cache storage returned HTTP ${response.status}.`));
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
  const verified = await getCachedAudio(
    createCacheUrl(messageId, versionNumber, sourceVoice),
    authorization,
    signal,
  );
  if (!verified?.audio) throw new Error("Saved audio could not be found after the upload.");
  return verified.audio;
}

export async function prepareAssistantSpeech(
  client: AppSupabaseClient | null,
  messageId: string,
  versionNumber: number,
  text: string,
  signal: AbortSignal,
  skipGemini = false,
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

  if (!authorization) {
    errors.push("Sign in is required to check or save generated speech.");
    return { audio: null, voice, source: null, errors };
  }

  const geminiCacheKey = speechCacheKey(messageId, versionNumber, "gemini", voice);
  const memoryCached = skipGemini ? undefined : inMemorySpeechCache.get(geminiCacheKey);
  if (memoryCached) return { audio: memoryCached.audio, voice, source: "gemini", errors };

  if (!skipGemini) {
    try {
      const cached = await getCachedAudio(
        createCacheUrl(messageId, versionNumber, voice),
        authorization,
        signal,
      );
      if (cached) {
        rememberSpeech(geminiCacheKey, cached);
        return { audio: cached.audio, voice, source: "gemini", errors };
      }
    } catch (error) {
      if (signal.aborted) throw error;
      errors.push(
        `Saved Gemini audio could not be checked; trying another speech source: ${
          error instanceof Error ? error.message : "Unknown cache read error."
        }`,
      );
    }
  }

  if (!skipGemini && apiKeys.length > 0) {
    let geminiAudio: Blob | null = null;
    try {
      geminiAudio = await generateGeminiSpeech(apiKeys, text, voice, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      errors.push(
        error instanceof Error ? error.message : "All configured Gemini TTS keys failed.",
      );
    }

    if (geminiAudio) {
      try {
        geminiAudio = await saveCachedAudio(
          geminiAudio,
          messageId,
          versionNumber,
          "gemini",
          voice,
          "audio/wav",
          authorization,
          signal,
        );
      } catch (error) {
        if (signal.aborted) throw error;
        errors.push(
          `Generated Gemini audio could not be saved for replay: ${
            error instanceof Error ? error.message : "Unknown cache storage error."
          }`,
        );
        console.error(
          `Generated Gemini speech for message ${messageId} version ${versionNumber} could not be cached for 24 hours.`,
          error,
        );
      }

      rememberSpeech(geminiCacheKey, { audio: geminiAudio });
      return { audio: geminiAudio, voice, source: "gemini", errors };
    }
  }

  const soundOfTextCacheKey = speechCacheKey(messageId, versionNumber, "soundoftext", "id-ID");
  const memorySoundOfText = inMemorySpeechCache.get(soundOfTextCacheKey);
  if (memorySoundOfText) {
    return { audio: memorySoundOfText.audio, voice, source: "soundoftext", errors };
  }

  let audio: Blob | null = null;
  try {
    const response = await fetch(new URL("/api/sound-of-text-speech", window.location.origin), {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messageId, versionNumber }),
      signal,
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(responseErrorMessage(body, `Sound of Text returned HTTP ${response.status}.`));
    }
    const soundOfTextAudio = await response.blob();
    if (!soundOfTextAudio.size) throw new Error("Sound of Text returned an empty audio file.");
    audio = soundOfTextAudio;
  } catch (error) {
    if (signal.aborted) throw error;
    errors.push(
      `Sound of Text could not generate speech: ${
        error instanceof Error ? error.message : "Unknown Sound of Text error."
      }`,
    );
  }

  if (audio) {
    rememberSpeech(soundOfTextCacheKey, { audio });
    return { audio, voice, source: "soundoftext", errors };
  }

  return { audio: null, voice, source: null, errors };
}
