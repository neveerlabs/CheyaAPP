const SOUND_OF_TEXT_API = "https://api.soundoftext.com";
const SOUND_OF_TEXT_AUDIO_HOST = "files.soundoftext.com";
const MAX_SPEECH_CHARACTERS = 5000;
const MAX_AUDIO_BYTES = 18 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_WAIT_MS = 30_000;

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

async function fetchSoundOfText(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

async function readJson<T>(response: Response, description: string): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error(`Sound of Text returned an invalid ${description} response.`);
  }
}

export async function generateSoundOfTextAudio(text: string): Promise<Blob> {
  if (!text.trim() || text.length > MAX_SPEECH_CHARACTERS) {
    throw new Error(`Sound of Text requires 1–${MAX_SPEECH_CHARACTERS} characters.`);
  }

  const createResponse = await fetchSoundOfText(`${SOUND_OF_TEXT_API}/sounds`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ engine: "Google", data: { text, voice: "id-ID" } }),
  });
  const created = await readJson<SoundCreationResponse>(createResponse, "sound creation");
  if (
    !createResponse.ok ||
    !created.success ||
    !created.id ||
    !/^[0-9a-f-]{36}$/i.test(created.id)
  ) {
    throw new Error(
      `Sound of Text could not create speech: ${
        created.message || createResponse.statusText || "unknown service error."
      }`,
    );
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
      throw new Error(`Sound of Text could not check speech status (${statusResponse.status}).`);
    }
    if (status.status === "Error") {
      throw new Error(`Sound of Text failed to generate speech: ${status.message || "unknown service error."}`);
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
        throw new Error("Sound of Text returned an invalid audio link.");
      }
      if (!audioUrl) throw new Error("Sound of Text returned an unsupported audio link.");
      break;
    }
    if (status.status !== "Pending") {
      throw new Error("Sound of Text returned an unknown speech status.");
    }
    if (Date.now() + delayMs >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    delayMs = Math.min(delayMs * 2, 16_000);
  }
  if (!audioUrl) throw new Error("Sound of Text did not finish generating speech in time.");

  const response = await fetchSoundOfText(audioUrl.toString());
  let finalUrl: URL;
  try {
    finalUrl = new URL(response.url);
  } catch {
    throw new Error("Sound of Text returned an invalid final audio URL.");
  }
  if (finalUrl.protocol !== "https:" || finalUrl.hostname !== SOUND_OF_TEXT_AUDIO_HOST) {
    throw new Error("Sound of Text redirected audio to an unsupported host.");
  }
  const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (
    !response.ok ||
    !response.body ||
    (contentType !== "audio/mpeg" &&
      contentType !== "audio/mp3" &&
      contentType !== "application/octet-stream")
  ) {
    throw new Error(`Sound of Text returned an unsupported audio response (${response.status}).`);
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_AUDIO_BYTES) {
    throw new Error("The generated Sound of Text audio is too large to store.");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_AUDIO_BYTES) {
      await reader.cancel();
      throw new Error("The generated Sound of Text audio is too large to store.");
    }
    chunks.push(value);
  }
  if (!totalBytes) throw new Error("Sound of Text returned an empty audio file.");
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Blob([bytes], { type: "audio/mpeg" });
}
