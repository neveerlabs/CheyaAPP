export type InsightSchema = {
  userId: string;
  snapshot: {
    tone: string;
    communication_style: string;
    topics: string[];
    support_needs: string;
    summary: string;
    updated_at: string;
  };
};
