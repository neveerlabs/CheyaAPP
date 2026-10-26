export type RagChunkSchema = {
  id: string;
  sourceType: string;
  sourceId: string;
  content: string;
  similarity: number;
  weight: number;
  metadata?: Record<string, unknown>;
};
