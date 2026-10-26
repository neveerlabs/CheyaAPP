import type { MemoryCategory } from "./types";

export type { MemoryEntry, MemoryWindowItem } from "./types";
export type { MemoryCategory } from "./types";

export const MEMORY_CATEGORY_ALLOWLIST = ["preference", "profile", "goal", "other", "general"] as const;

export function normalizeMemoryCategory(category?: string): MemoryCategory {
  const normalized = (category ?? "general").trim().toLowerCase();
  return MEMORY_CATEGORY_ALLOWLIST.includes(normalized as MemoryCategory)
    ? (normalized as MemoryCategory)
    : "general";
}

export function getRecentWindow<T extends { id: string; createdAt?: string }>(
  items: T[],
  limit = 6,
): T[] {
  return [...items].slice(-limit);
}
