import type { InsightSnapshot, MessageInsightLike } from "./types";

export function aggregateUserSnapshot(entries: MessageInsightLike[] = []): InsightSnapshot {
  const topics = Array.from(
    new Set(entries.flatMap((entry) => entry.topics ?? []).map((topic) => topic.trim()).filter(Boolean)),
  ).slice(0, 6);

  const summary = entries
    .map((entry) => entry.summary)
    .filter(Boolean)
    .slice(0, 3)
    .join(" • ") || "Belum ada ringkasan yang cukup.";

  return {
    tone: entries.some((entry) => /sedih|frustrasi|bosan|cemas/i.test(entry.summary))
      ? "empati"
      : "hangat",
    communication_style: entries.some((entry) => /langsung|tegas|efisien/i.test(entry.communication_style))
      ? "langsung"
      : "ramah",
    topics,
    support_needs: entries.some((entry) => /bantuan|konsultasi|rencana|pengingat/i.test(entry.summary))
      ? "bantuan yang praktis dan jelas"
      : "percakapan ringan yang relevan",
    summary,
    updated_at: new Date().toISOString(),
  };
}
