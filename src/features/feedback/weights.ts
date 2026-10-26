import { applyWeightDelta, normalizeFeedbackKind } from "./service";

export { applyWeightDelta, normalizeFeedbackKind };

export function feedbackWeightToMultiplier(kind: string | null | undefined): number {
  const normalized = normalizeFeedbackKind(kind);
  return normalized === "like" ? 1.05 : normalized === "dislike" ? 0.9 : 0.5;
}

export function adjustChunkWeight(currentWeight: number, kind: string | null | undefined): number {
  return applyWeightDelta(currentWeight, kind);
}
