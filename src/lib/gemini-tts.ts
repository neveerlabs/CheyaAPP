export const GEMINI_TTS_MODEL = "gemini-3.8-flash-lite-tts";

export const GEMINI_TTS_VOICES = [
  {
    id: "Kore",
    description: "Firm",
    sample: "Tenang, kita hadapi satu per satu. Kamu tidak harus menyelesaikan semuanya sekarang.",
  },
  {
    id: "Aoede",
    description: "Breezy",
    sample: "Coba lihat ke luar sebentar—hal kecil yang menyenangkan apa yang kamu temukan hari ini?",
  },
  {
    id: "Leda",
    description: "Youthful",
    sample: "Wah, itu langkah yang keren! Hal baru apa yang paling ingin kamu coba berikutnya?",
  },
  {
    id: "Callirrhoe",
    description: "Easy-going",
    sample: "Santai saja, ceritakan pelan-pelan. Aku di sini untuk mendengarkan.",
  },
  {
    id: "Achernar",
    description: "Soft",
    sample: "Tarik napas perlahan, lalu lepaskan. Beri dirimu waktu untuk merasa lebih tenang.",
  },
  {
    id: "Vindemiatrix",
    description: "Gentle",
    sample: "Kamu sudah berusaha sebaik mungkin. Jangan lupa bersikap lembut pada dirimu sendiri.",
  },
  {
    id: "Sulafat",
    description: "Warm",
    sample: "Selamat datang kembali. Semoga hari ini membawa sedikit rasa nyaman untukmu.",
  },
  {
    id: "Erinome",
    description: "Clear",
    sample: "Mari kita susun rencananya: tentukan tujuan, pilih langkah pertama, lalu mulai dari sana.",
  },
  {
    id: "Laomedeia",
    description: "Upbeat",
    sample: "Ayo, kita mulai! Satu langkah kecil hari ini bisa membawa perubahan besar nanti.",
  },
] as const;

export type GeminiTtsVoice = (typeof GEMINI_TTS_VOICES)[number]["id"];

export const DEFAULT_GEMINI_TTS_VOICE: GeminiTtsVoice = "Kore";
export const GEMINI_TTS_CACHE_BUCKET = "chat-tts-cache";
export const GEMINI_TTS_CACHE_RETENTION_MS = 24 * 60 * 60 * 1000;
let preferredGeminiTtsKeyIndex = 0;

export function isGeminiTtsVoice(value: string): value is GeminiTtsVoice {
  return GEMINI_TTS_VOICES.some((voice) => voice.id === value);
}

type GeminiInteractionResponse = {
  steps?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      data?: string;
    }>;
  }>;
};

type GeminiApiError = {
  error?: {
    message?: string;
  };
};

function readableErrorResponse(body: string, fallback: string): string {
  const trimmed = body.trim();
  if (!trimmed.startsWith("<")) return trimmed.slice(0, 500) || fallback;
  const title = trimmed.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    ?.replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return title
    ? `The server returned an HTML error page: ${title.slice(0, 240)}`
    : "The server returned an HTML error page instead of a Gemini TTS response.";
}

export async function generateGeminiSpeech(
  apiKeys: string[],
  text: string,
  voice: GeminiTtsVoice,
  signal?: AbortSignal,
): Promise<Blob> {
  const configuredKeys = [...new Set(apiKeys.map((key) => key.trim()).filter(Boolean))];
  if (configuredKeys.length === 0) {
    throw new Error("Add at least one Gemini TTS API key in Settings → Configure.");
  }

  const failures: string[] = [];
  const firstIndex = preferredGeminiTtsKeyIndex % configuredKeys.length;
  for (let offset = 0; offset < configuredKeys.length; offset += 1) {
    if (signal?.aborted) throw new DOMException("The TTS request was cancelled.", "AbortError");
    const index = (firstIndex + offset) % configuredKeys.length;
    try {
      const audio = await generateSpeechWithKey(configuredKeys[index], text, voice, signal);
      preferredGeminiTtsKeyIndex = index;
      return audio;
    } catch (error) {
      if (signal?.aborted) throw error;
      failures.push(`Key ${index + 1}: ${error instanceof Error ? error.message : "Unknown API error."}`);
    }
  }

  throw new Error(
    `All ${configuredKeys.length} Gemini TTS API key${configuredKeys.length === 1 ? "" : "s"} failed:\n${failures.join("\n")}`,
  );
}

async function generateSpeechWithKey(
  apiKey: string,
  text: string,
  voice: GeminiTtsVoice,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      model: GEMINI_TTS_MODEL,
      input: [
        {
          type: "user_input",
          content: [
            {
              type: "text",
              text,
              annotations: [
                {
                  type: "speech_metadata",
                  style: "Read the text verbatim. Infer natural expressive delivery from its meaning and emotional tone, matching mood, pacing, emphasis, and intonation without adding spoken words.",
                },
              ],
            },
          ],
        },
      ],
      response_format: { type: "audio" },
      generation_config: {
        speech_config: [{ voice }],
      },
    }),
    signal,
  });

  const responseText = await response.text();
  let payload: GeminiInteractionResponse & GeminiApiError;
  try {
    payload = JSON.parse(responseText) as GeminiInteractionResponse & GeminiApiError;
  } catch {
    throw new Error(
      response.ok
        ? `Gemini TTS returned an invalid response: ${readableErrorResponse(responseText, "The response was empty.")}`
        : `Gemini TTS request failed (${response.status}): ${readableErrorResponse(responseText, response.statusText)}`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `Gemini TTS request failed (${response.status}): ${
        readableErrorResponse(payload.error?.message ?? "", response.statusText)
      }`,
    );
  }

  const audioData = payload.steps
    ?.filter((step) => step.type === "model_output")
    .flatMap((step) => step.content ?? [])
    .filter((content) => content.type === "audio")
    .map((content) => content.data)
    .find((data): data is string => Boolean(data));
  if (!audioData) {
    throw new Error("Gemini TTS returned successfully but did not include audio data.");
  }

  let binaryAudio: string;
  try {
    binaryAudio = atob(audioData);
  } catch {
    throw new Error("Gemini TTS returned audio in an invalid format.");
  }
  const bytes = Uint8Array.from(binaryAudio, (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: "audio/wav" });
}
