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
  audio: Blob | null;
  browserVoiceName?: string;
  errors?: string[];
};

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
  if (typeof payload === "object" && payload !== null && "source" in payload) {
    if (payload.source === "browser") {
      const voiceName =
        "voiceName" in payload && typeof payload.voiceName === "string"
          ? payload.voiceName
          : "";
      if (!voiceName) throw new Error("The saved browser speech fallback is missing its voice name.");
      return {
        audio: null,
        browserVoiceName: voiceName,
        errors:
          "errors" in payload && typeof payload.errors === "string"
            ? payload.errors.split("\n\n").filter(Boolean)
            : [],
      };
    }
  }
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

  if (authorization) {
    try {
      const cached = await getCachedAudio(cacheUrl, authorization, signal);
      if (cached?.browserVoiceName && apiKeys.length === 0) {
        return {
          audio: null,
          voice,
          browserVoiceName: cached.browserVoiceName,
          errors: [...errors, ...(cached.errors ?? [])],
        };
      }
      if (cached?.audio) return { audio: cached.audio, voice, errors };
    } catch (error) {
      if (signal.aborted) throw error;
      errors.push(
        `Saved audio could not be loaded: ${
          error instanceof Error ? error.message : "Unknown cache read error."
        }`,
      );
    }
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
  if (!authorization) {
    errors.push("Generated audio cannot be saved without a signed-in account session.");
    return { audio, voice, errors };
  }

  try {
    const response = await fetch("/api/tts-audio-cache", {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "audio/wav",
        "X-Chat-Message-Id": messageId,
        "X-Chat-Version-Number": String(versionNumber),
        "X-Gemini-TTS-Voice": voice,
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

  return { audio, voice, errors };
}

export async function persistBrowserSpeechFallback(
  client: AppSupabaseClient | null,
  messageId: string,
  versionNumber: number,
  voice: GeminiTtsVoice,
  voiceName: string,
  errors: string[],
  signal: AbortSignal,
): Promise<void> {
  if (!client) throw new Error("Sign in to save this browser voice fallback for reuse.");
  const { data, error } = await client.auth.getSession();
  if (error) throw new Error(`Could not read the account session: ${error.message}`);
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error("Sign in to save this browser voice fallback for reuse.");

  const response = await fetch("/api/tts-audio-cache", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Chat-Message-Id": messageId,
      "X-Chat-Version-Number": String(versionNumber),
      "X-Gemini-TTS-Voice": voice,
      "X-Gemini-TTS-Source": "browser",
    },
    body: JSON.stringify({ voiceName, errors: errors.join("\n\n").slice(0, 8000) }),
    signal,
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      responseErrorMessage(body, `Browser speech cache returned HTTP ${response.status}.`),
    );
  }
  const saved: unknown = await response.json();
  if (
    typeof saved !== "object" ||
    saved === null ||
    !("cached" in saved) ||
    saved.cached !== true
  ) {
    throw new Error("The database did not confirm that the browser voice fallback was saved.");
  }
  const cacheUrl = new URL("/api/tts-audio-cache", window.location.origin);
  cacheUrl.searchParams.set("messageId", messageId);
  cacheUrl.searchParams.set("versionNumber", String(versionNumber));
  cacheUrl.searchParams.set("voice", voice);
  const verification = await fetch(cacheUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  });
  if (!verification.ok) {
    const body = await verification.text();
    throw new Error(
      responseErrorMessage(body, `Browser voice cache verification returned HTTP ${verification.status}.`),
    );
  }
  const verified: unknown = await verification.json();
  if (
    typeof verified !== "object" ||
    verified === null ||
    !("source" in verified) ||
    verified.source !== "browser" ||
    !("voiceName" in verified) ||
    verified.voiceName !== voiceName
  ) {
    throw new Error("The saved browser voice could not be verified in the database.");
  }
}
