import type { FeedbackExample, FeedbackKind } from "./types";

export type { FeedbackExample, FeedbackKind, FeedbackSnapshot } from "./types";

export const FEEDBACK_WEIGHT_BY_KIND: Record<FeedbackKind, number> = {
  like: 1.05,
  dislike: 0.9,
  warning: 0.5,
  report: 0.5,
};

export function normalizeFeedbackKind(kind?: string | null): FeedbackKind {
  const normalized = (kind ?? "warning").trim().toLowerCase();
  if (normalized === "report") return "warning";
  if (normalized === "like" || normalized === "dislike" || normalized === "warning") {
    return normalized;
  }
  return "warning";
}

export function getExamples(items: FeedbackExample[] = [], limit = 5): FeedbackExample[] {
  return [...items].sort((first, second) => second.createdAt.localeCompare(first.createdAt)).slice(0, limit);
}

export function applyWeightDelta(weight: number, kind?: string | null): number {
  const normalized = normalizeFeedbackKind(kind);
  return Math.max(0.01, Number((weight * FEEDBACK_WEIGHT_BY_KIND[normalized]).toFixed(6)));
}
