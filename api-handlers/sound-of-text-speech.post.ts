import { createError, defineEventHandler, getHeader, readBody } from "nitro/h3";
import { createAuthenticatedServerClient, createServiceRoleClient } from "../src/lib/server-supabase";
import { speechTextFromMarkdown } from "../src/lib/speech-text";

const SOUND_OF_TEXT_API = "https://api.soundoftext.com";
const SOUND_OF_TEXT_AUDIO_HOST = "files.soundoftext.com";
const MAX_SPEECH_CHARACTERS = 5000;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_WAIT_MS = 30_000;

type SpeechRequest = {
  messageId?: unknown;
  versionNumber?: unknown;
};

type SoundCreationResponse = {
  success?: boolean;
  id?: string;
  message?: string;
};

type SoundStatusResponse = {
  status?: string;
  location?: string;
  message?: string;
};

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

async function readJson<T>(response: Response, description: string): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw createError({
      statusCode: 502,
      statusMessage: `Sound of Text returned an invalid ${description} response.`,
    });
  }
}

async function fetchSoundOfText(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw createError({
      statusCode: 502,
      statusMessage: `Could not reach Sound of Text: ${
        error instanceof Error ? error.message : "network request failed."
      }`,
    });
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export default defineEventHandler(async (event) => {
  const accessToken = getHeader(event, "authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) {
    throw createError({ statusCode: 401, statusMessage: "Sign in before generating speech." });
  }

  const authClient = createAuthenticatedServerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser(accessToken);
  if (authError || !user || user.is_anonymous) {
    throw createError({ statusCode: 401, statusMessage: "Your account session is invalid or expired." });
  }

  const body = await readBody<SpeechRequest>(event);
  const messageId = body?.messageId;
  const versionNumber = body?.versionNumber;
  if (!isUuid(messageId) || !Number.isInteger(versionNumber) || Number(versionNumber) < 1) {
    throw createError({ statusCode: 400, statusMessage: "The assistant message reference is invalid." });
  }

  const serviceClient = createServiceRoleClient();
  const { data: message, error: messageError } = await serviceClient
    .from("chat_messages")
    .select("role")
    .eq("user_id", user.id)
    .eq("id", messageId)
    .maybeSingle();
  if (messageError) {
    throw createError({
      statusCode: 500,
      statusMessage: `Could not verify the assistant message: ${messageError.message}`,
    });
  }
  if (message?.role !== "assistant") {
    throw createError({ statusCode: 404, statusMessage: "The assistant message was not found." });
  }

  const { data: version, error: versionError } = await serviceClient
    .from("chat_message_versions")
    .select("content")
    .eq("user_id", user.id)
    .eq("message_id", messageId)
    .eq("version_number", versionNumber)
    .maybeSingle();
  if (versionError) {
    throw createError({
      statusCode: 500,
      statusMessage: `Could not load the assistant message version: ${versionError.message}`,
    });
  }
  if (!version) {
    throw createError({ statusCode: 404, statusMessage: "The assistant message version was not found." });
  }

  const text = speechTextFromMarkdown(version.content);
  if (!text) {
    throw createError({ statusCode: 400, statusMessage: "There is no readable text in this message." });
  }
  if (text.length > MAX_SPEECH_CHARACTERS) {
    throw createError({
      statusCode: 413,
      statusMessage: `Sound of Text supports up to ${MAX_SPEECH_CHARACTERS.toLocaleString()} characters per message.`,
    });
  }

  const createResponse = await fetchSoundOfText(`${SOUND_OF_TEXT_API}/sounds`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      engine: "Google",
      data: { text, voice: "id-ID" },
    }),
  });
  const created = await readJson<SoundCreationResponse>(createResponse, "sound creation");
  if (!createResponse.ok || !created.success || !isUuid(created.id)) {
    throw createError({
      statusCode: 502,
      statusMessage: `Sound of Text could not create speech: ${created.message || createResponse.statusText || "unknown service error."}`,
    });
  }

  let delayMs = 1000;
  const deadline = Date.now() + MAX_WAIT_MS;
  let audioUrl: URL | null = null;
  while (Date.now() < deadline) {
    const statusResponse = await fetchSoundOfText(
      `${SOUND_OF_TEXT_API}/sounds/${encodeURIComponent(created.id)}`,
    );
    const status = await readJson<SoundStatusResponse>(statusResponse, "sound status");
    if (!statusResponse.ok) {
      throw createError({
        statusCode: 502,
        statusMessage: `Sound of Text could not check speech status (${statusResponse.status}).`,
      });
    }
    if (status.status === "Error") {
      throw createError({
        statusCode: 502,
        statusMessage: `Sound of Text failed to generate speech: ${status.message || "unknown service error."}`,
      });
    }
    if (status.status === "Done" && typeof status.location === "string") {
      try {
        const candidate = new URL(status.location);
        if (
          candidate.protocol === "https:" &&
          candidate.hostname === SOUND_OF_TEXT_AUDIO_HOST &&
          candidate.pathname.endsWith(".mp3")
        ) {
          audioUrl = candidate;
        }
      } catch {
        throw createError({
          statusCode: 502,
          statusMessage: "Sound of Text returned an invalid audio link.",
        });
      }
      if (!audioUrl) {
        throw createError({
          statusCode: 502,
          statusMessage: "Sound of Text returned an unsupported audio link.",
        });
      }
      break;
    }
    if (status.status !== "Pending") {
      throw createError({ statusCode: 502, statusMessage: "Sound of Text returned an unknown speech status." });
    }
    if (Date.now() + delayMs >= deadline) break;
    await wait(delayMs);
    delayMs = Math.min(delayMs * 2, 16_000);
  }

  if (!audioUrl) {
    throw createError({
      statusCode: 504,
      statusMessage: "Sound of Text did not finish generating speech in time.",
    });
  }

  const audioResponse = await fetchSoundOfText(audioUrl.toString());
  const audioContentType = audioResponse.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();
  let finalAudioUrl: URL;
  try {
    finalAudioUrl = new URL(audioResponse.url);
  } catch {
    throw createError({
      statusCode: 502,
      statusMessage: "Sound of Text returned an invalid final audio URL.",
    });
  }
  if (
    finalAudioUrl.protocol !== "https:" ||
    finalAudioUrl.hostname !== SOUND_OF_TEXT_AUDIO_HOST
  ) {
    throw createError({
      statusCode: 502,
      statusMessage: "Sound of Text redirected audio to an unsupported host.",
    });
  }
  if (!audioResponse.ok || !audioResponse.body) {
    throw createError({
      statusCode: 502,
      statusMessage: `Could not download the generated Sound of Text audio (HTTP ${audioResponse.status}, ${audioContentType || "unknown content type"}).`,
    });
  }
  if (
    audioContentType !== "audio/mpeg" &&
    audioContentType !== "audio/mp3" &&
    audioContentType !== "application/octet-stream"
  ) {
    throw createError({
      statusCode: 502,
      statusMessage: `Sound of Text returned an unsupported audio content type: ${audioContentType || "missing"}.`,
    });
  }
  const declaredLength = Number(audioResponse.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_AUDIO_BYTES) {
    throw createError({ statusCode: 413, statusMessage: "The generated speech audio is too large." });
  }

  const reader = audioResponse.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_AUDIO_BYTES) {
        await reader.cancel();
        throw createError({ statusCode: 413, statusMessage: "The generated speech audio is too large." });
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error && typeof error === "object" && "statusCode" in error) throw error;
    throw createError({ statusCode: 502, statusMessage: "Could not read the generated Sound of Text audio." });
  }

  if (totalBytes === 0) {
    throw createError({ statusCode: 502, statusMessage: "Sound of Text returned an empty audio file." });
  }
  const audio = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    audio.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Response(audio, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(audio.byteLength),
      "Cache-Control": "no-store",
    },
  });
});
