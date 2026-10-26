export type FeedbackSchema = {
  id: string;
  kind: "like" | "dislike" | "warning" | "report";
  response: string;
  topic: string;
  createdAt: string;
};
