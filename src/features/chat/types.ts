export type ChatRole = "user" | "assistant";

export type ChatWindowItem = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
};

export type ChatMessageSnapshot = {
  id: string;
  userId: string;
  role: ChatRole;
  content: string;
  createdAt: string;
};
