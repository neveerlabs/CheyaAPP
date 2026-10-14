import type { GeminiApiKey, PersonalizationSettings } from "./supabase";

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: {
    message?: string;
  };
}

export interface GeminiAttempt {
  keyId: string;
  status: "active" | "error";
  error: string | null;
}

export interface GeminiReply {
  text: string;
  keyId: string;
  keyIndex: number;
  attempts: GeminiAttempt[];
}

const emptyPersonalization: PersonalizationSettings = {
  display_name: "",
  custom_prompt: "",
  chat_style: "",
};

export class GeminiFailoverError extends Error {
  constructor(
    message: string,
    readonly attempts: GeminiAttempt[],
  ) {
    super(message);
    this.name = "GeminiFailoverError";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An unknown network error occurred.";
}

export async function generateGeminiReply(
  keys: GeminiApiKey[],
  prompt: string,
  startingIndex: number,
  personalization: PersonalizationSettings = emptyPersonalization,
): Promise<GeminiReply> {
  if (keys.length === 0) {
    throw new Error("Add at least one Gemini API key in Settings before sending a message.");
  }

  const attempts: GeminiAttempt[] = [];
  const firstIndex = ((startingIndex % keys.length) + keys.length) % keys.length;
  const instructions = [
    personalization.display_name.trim()
      ? `The user's preferred name is ${personalization.display_name.trim()}. Use it naturally when appropriate.`
      : "",
    personalization.chat_style.trim()
      ? `Conversation style: ${personalization.chat_style.trim()}.`
      : "",
    personalization.custom_prompt.trim()
      ? `Additional user instructions: ${personalization.custom_prompt.trim()}`
      : "",
  ].filter(Boolean);
  const requestPrompt = instructions.length
    ? `${instructions.join("\n")}\n\nUser message:\n${prompt}`
    : prompt;

  for (let offset = 0; offset < keys.length; offset += 1) {
    const keyIndex = (firstIndex + offset) % keys.length;
    const key = keys[keyIndex];

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${key.model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": key.api_key,
          },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: requestPrompt }] }],
          }),
        },
      );
      const payload = (await response.json()) as GeminiResponse;

      if (!response.ok) {
        throw new Error(payload.error?.message ?? `Gemini returned HTTP ${response.status}.`);
      }

      const text = payload.candidates
        ?.flatMap((candidate) => candidate.content?.parts ?? [])
        .map((part) => part.text ?? "")
        .join("")
        .trim();

      if (!text) {
        throw new Error("Gemini returned no text. The request may have been blocked or filtered.");
      }

      attempts.push({ keyId: key.id, status: "active", error: null });
      return { text, keyId: key.id, keyIndex, attempts };
    } catch (error) {
      const message = errorMessage(error);
      attempts.push({ keyId: key.id, status: "error", error: message });
    }
  }

  throw new GeminiFailoverError(
    `Every configured Gemini API failed:\n${attempts
      .map((attempt) => `${attempt.keyId}: ${attempt.error}`)
      .join("\n")}`,
    attempts,
  );
}
