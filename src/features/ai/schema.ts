export type AiSchema = {
  mode: "fast" | "thinking";
  messages: Array<{ role: "user" | "model"; content: string }>;
  tools: unknown[];
  systemInstruction: string;
};
