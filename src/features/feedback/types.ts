export type FeedbackKind = "like" | "dislike" | "warning" | "report";

export type FeedbackExample = {
  id: string;
  topic: string;
  kind: FeedbackKind;
  response: string;
  createdAt: string;
};

export interface FeedbackSnapshot {
  messageId: string;
  versionNumber: number;
  kind: FeedbackKind;
  contents: string[];
}
