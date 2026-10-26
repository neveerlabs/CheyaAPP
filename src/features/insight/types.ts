export type InsightSnapshot = {
  tone: string;
  communication_style: string;
  topics: string[];
  support_needs: string;
  summary: string;
  updated_at: string;
};

export type MessageInsightLike = {
  id: string;
  user_id: string;
  message_id: string;
  mood: string;
  communication_style: string;
  situation: string;
  topics: string[];
  support_needs: string;
  summary: string;
  created_at: string;
};
