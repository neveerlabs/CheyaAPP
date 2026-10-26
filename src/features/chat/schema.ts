export type ChatSchema = {
  id: string;
  userId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};
