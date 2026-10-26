export type RetrievalMode = "fast" | "full";

export type RetrievedChunk = {
  id: string;
  sourceType: "message" | "memory" | "product_help" | "doc";
  sourceId: string;
  content: string;
  similarity: number;
  weight: number;
  metadata?: Record<string, unknown>;
};

export interface RetrieveContextOptions {
  userId?: string;
  queryEmbedding: number[];
  mode?: RetrievalMode;
  excludeId?: string;
  beforeCreatedAt?: string;
  keywordText?: string;
  limit?: number;
}
