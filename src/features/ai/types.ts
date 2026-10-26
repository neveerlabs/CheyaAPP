export type Mode = "fast" | "thinking";

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: {
    type: "OBJECT";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

export type PromptContentPart = {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
};

export type PromptContent = {
  role: "user" | "model";
  parts?: PromptContentPart[];
};

export interface PromptBuildResult {
  systemInstruction: string;
  contents: PromptContent[];
  tools: ToolDefinition[];
  toolConfig: {
    functionCallingConfig: {
      mode: "AUTO" | "NONE";
    };
  };
}

export interface PromptBuildOptions {
  mode?: Mode;
  role?: string;
  hasTools?: boolean;
  userMessage?: string;
  insightSnapshot?: Record<string, unknown> | null;
  retrievedContext?: Array<{ content: string; sourceType?: string; similarity?: number }>;
  recentWindow?: Array<{ content: string; role?: string }>;
  feedbackExamples?: Array<{ response?: string; kind?: string }>;
}
