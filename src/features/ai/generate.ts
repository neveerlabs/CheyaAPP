import { FAST_MODE, THINKING_MODE, buildPrompt } from "./prompt-builder";
import type { Mode } from "./types";

export { FAST_MODE, THINKING_MODE };

export function generateGeminiConversation(
  _keys: unknown[],
  _prompt: string,
  _index: number,
  _personalization?: unknown,
  _context?: unknown,
  mode: Mode = "fast",
) {
  const config = mode === "fast" ? FAST_MODE : THINKING_MODE;
  const built = buildPrompt({
    mode,
    userMessage: _prompt,
    hasTools: Boolean(_context),
  });

  return {
    ...built,
    config,
    mode,
  };
}
