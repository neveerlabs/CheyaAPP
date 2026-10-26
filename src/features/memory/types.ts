export type MemoryCategory = "preference" | "profile" | "goal" | "other" | "general";

export type MemoryEntry = {
  id: string;
  userId: string;
  category: MemoryCategory;
  content: string;
  createdAt: string;
  updatedAt: string;
  sourceMessageId?: string | null;
};

export interface MemoryWindowItem {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}
