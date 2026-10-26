import type { ChatWindowItem } from "./types";

export type { ChatRole, ChatWindowItem, ChatMessageSnapshot } from "./types";

export function getRecentWindow(items: ChatWindowItem[] = [], limit = 6): ChatWindowItem[] {
  return [...items].slice(-Math.max(0, limit));
}
