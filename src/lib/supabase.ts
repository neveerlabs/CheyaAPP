import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ChatAttachment } from "./chat-attachments";
import {
  DEFAULT_GEMINI_TTS_VOICE,
  type GeminiTtsVoice,
} from "./gemini-tts";

export const DATABASE_CONFIG_KEY = "cheyaverse.supabase.bootstrap";
export const MULTIMODAL_GEMINI_MODELS = [
  "gemini-3.5-flash-lite",
] as const;

export const GEMINI_MODELS = MULTIMODAL_GEMINI_MODELS;

export type GeminiModel = (typeof GEMINI_MODELS)[number];
export type ApiStatus = "untested" | "active" | "error";
export type AccountRole = "admin" | "user";
export type AccountProvider = "google" | "github";

const AUTH_PROVIDER_INTENT_KEY = "cheyaverse.auth-provider-intent";

export function getPendingAuthProvider(): AccountProvider | null {
  const provider = window.sessionStorage.getItem(AUTH_PROVIDER_INTENT_KEY);
  return provider === "google" || provider === "github" ? provider : null;
}

export function clearPendingAuthProvider(): void {
  window.sessionStorage.removeItem(AUTH_PROVIDER_INTENT_KEY);
}

function setPendingAuthProvider(provider: AccountProvider): void {
  window.sessionStorage.setItem(AUTH_PROVIDER_INTENT_KEY, provider);
}

export type AccountProfile = {
  user_id: string;
  role: AccountRole;
  provider: string;
  email: string | null;
  github_username: string | null;
  welcome_email_sent_at: string | null;
  welcome_email_claimed_at: string | null;
  updated_at: string;
};
export type AccountInboxItem = {
  id: string;
  recipient_user_id: string;
  sender_user_id: string | null;
  source_job_id: string | null;
  kind: "admin_message" | "reminder" | "ai_error";
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
};

export type AdminMessageRequest = {
  id: string;
  admin_user_id: string;
  recipient_user_ids: string[];
  all_accounts: boolean;
  title: string;
  body: string;
  status: "pending" | "sent" | "cancelled";
  created_at: string;
  sent_at: string | null;
};

export type AdminMessage = {
  id: string;
  sender_user_id: string;
  source_message_id: string | null;
  body: string;
  attachment_id: string | null;
  created_at: string;
};

export type AdminMessageFeedback = {
  admin_message_id: string;
  user_id: string;
  kind: "like" | "dislike" | "report";
  details: string | null;
  updated_at: string;
};

export type ProductHelpRequest = {
  id: string;
  user_id: string;
  source_message_id: string | null;
  source_message_version_number: number | null;
  admin_message_id: string | null;
  question: string;
  status: "pending" | "awaiting_confirmation" | "answered" | "withdrawn";
  draft_title: string | null;
  draft_answer: string | null;
  draft_admin_user_id: string | null;
  draft_created_at: string | null;
  answer: string | null;
  answer_message_id: string | null;
  created_at: string;
  answered_at: string | null;
};

export type PublicMemory = {
  id: string;
  category: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
};

export type AdminPublicMemoryRequest = {
  id: string;
  admin_user_id: string;
  source_message_id: string;
  source_message_version_number: number;
  question: string;
  status: "collecting" | "awaiting_confirmation" | "published" | "withdrawn";
  draft_title: string | null;
  draft_content: string | null;
  draft_updated_at: string | null;
  public_memory_id: string | null;
  created_at: string;
  published_at: string | null;
};

export type AiReminder = {
  id: string;
  user_id: string;
  source_message_id: string | null;
  title: string;
  body: string;
  next_run_at: string;
  timezone: "Asia/Jakarta";
  repeat_interval_seconds: number | null;
  repeat_every: number | null;
  repeat_unit: "minute" | "hour" | "day" | "week" | "month" | "year" | null;
  active: boolean;
  created_at: string;
  completed_at: string | null;
};

export interface DatabaseConfig {
  url: string;
  publishableKey: string;
}

type AccountDataSnapshot = {
  user_settings: Database["public"]["Tables"]["user_settings"]["Row"] | null;
  ai_api_keys: Database["public"]["Tables"]["ai_api_keys"]["Row"][];
  chat_messages: Database["public"]["Tables"]["chat_messages"]["Row"][];
  chat_message_versions: Database["public"]["Tables"]["chat_message_versions"]["Row"][];
  message_insights: Database["public"]["Tables"]["message_insights"]["Row"][];
  user_memories: Database["public"]["Tables"]["user_memories"]["Row"][];
  message_feedback: Database["public"]["Tables"]["message_feedback"]["Row"][];
};

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type ChatJobStatus = "queued" | "processing" | "completed" | "failed";

export type ChatMessageJob = {
  id: string;
  user_id: string;
  message_id: string;
  assistant_message_id: string | null;
  thinking_mode: boolean;
  status: ChatJobStatus;
  progress: string;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export interface PersonalizationSettings {
  display_name: string;
  custom_prompt: string;
  chat_style: string;
}

export interface GeneralSettings {
  enter_key_behavior_desktop: "system" | "submit" | "newline";
  enter_key_behavior_mobile: "system" | "submit" | "newline";
  time_format: "system" | "12h" | "24h";
  font_size: number;
  web_search_enabled: boolean;
}

export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
  enter_key_behavior_desktop: "system",
  enter_key_behavior_mobile: "system",
  time_format: "system",
  font_size: 14,
  web_search_enabled: true,
};

export interface GeminiTtsSettings {
  tts_api_keys: string[];
  tts_voice: GeminiTtsVoice;
}

export const DEFAULT_PERSONALIZATION: PersonalizationSettings = {
  display_name: "",
  custom_prompt: "",
  chat_style: "",
};

export const DEFAULT_GEMINI_TTS_SETTINGS: GeminiTtsSettings = {
  tts_api_keys: [],
  tts_voice: DEFAULT_GEMINI_TTS_VOICE,
};

export type GeminiApiKey = {
  id: string;
  model: GeminiModel;
  api_key: string;
  status: ApiStatus;
  last_error: string | null;
  created_at: string;
}

export type GeminiTtsAudioCache = {
  id: string;
  user_id: string;
  message_id: string;
  version_number: number;
  voice: GeminiTtsVoice | "id-ID";
  storage_path: string;
  source: "gemini" | "soundoftext";
  created_at: string;
  expires_at: string;
};

export type AccountSession = {
  id: string;
  user_id: string;
  origin: string;
  path: string;
  user_agent: string;
  started_at: string;
  last_seen_at: string;
  is_active: boolean;
};

export type StoredChatMessage = {
  id: string;
  user_id: string;
  admin_message_id: string | null;
  role: "user" | "assistant";
  content: string;
  embedding: string | null;
  created_at: string;
  version_number: number;
  thinking_summary: string | null;
  is_reminder: boolean;
  is_active: boolean;
  revision_reason: ChatMessageVersion["revision_reason"];
};

export type ChatMessageVersion = {
  id: string;
  user_id: string;
  message_id: string;
  version_number: number;
  source_message_id: string | null;
  source_message_version_number: number | null;
  content: string;
  embedding: string | null;
  thinking_summary: string | null;
  revision_reason: "initial" | "user_edit" | "regenerate" | "ai_update";
  created_at: string;
};

export type MessageInsight = {
  id: string;
  user_id: string;
  message_id: string;
  mood: string;
  communication_style: string;
  situation: string;
  topics: string[];
  support_needs: string;
  summary: string;
  embedding: string | null;
  created_at: string;
};

export type UserMemory = {
  id: string;
  user_id: string;
  source_message_id: string | null;
  category: string;
  content: string;
  embedding: string | null;
  created_at: string;
  updated_at: string;
};

export type MessageFeedback = {
  id: string;
  user_id: string;
  message_id: string;
  version_number: number;
  kind: "like" | "dislike" | "report";
  details: string | null;
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      ai_api_keys: {
        Row: GeminiApiKey & {
          user_id: string;
          provider: "gemini";
        };
        Insert: {
          id?: string;
          user_id?: string;
          admin_message_id?: string | null;
          provider?: "gemini";
          model: GeminiModel;
          api_key: string;
          status?: ApiStatus;
          last_error?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          provider: "gemini";
          model: GeminiModel;
          api_key: string;
          status: ApiStatus;
          last_error: string | null;
        }>;
        Relationships: never[];
      };
      retained_api_keys: {
        Row: {
          id: string;
          user_id: string | null;
          provider: "gemini" | "gemini_tts";
          model: string;
          api_key: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          provider: "gemini" | "gemini_tts";
          model: string;
          api_key: string;
          created_at?: string;
        };
        Update: never;
        Relationships: never[];
      };
      account_profiles: {
        Row: AccountProfile;
        Insert: never;
        Update: {
          welcome_email_sent_at?: string | null;
          welcome_email_claimed_at?: string | null;
        };
        Relationships: never[];
      };
      account_inbox: {
        Row: AccountInboxItem;
        Insert: {
          id?: string;
          recipient_user_id: string;
          sender_user_id?: string | null;
          source_job_id?: string | null;
          kind: AccountInboxItem["kind"];
          title: string;
          body: string;
          created_at?: string;
          read_at?: string | null;
        };
        Update: Partial<Pick<AccountInboxItem, "read_at">>;
        Relationships: never[];
      };
      admin_messages: {
        Row: AdminMessage;
        Insert: {
          id?: string;
          sender_user_id: string;
          source_message_id?: string | null;
          body: string;
          attachment_id?: string | null;
          created_at?: string;
        };
        Update: never;
        Relationships: never[];
      };
      product_help_requests: {
        Row: ProductHelpRequest;
        Insert: {
          id?: string;
          user_id: string;
          source_message_id?: string | null;
          source_message_version_number?: number | null;
          admin_message_id?: string | null;
          question: string;
          status?: ProductHelpRequest["status"];
          draft_title?: string | null;
          draft_answer?: string | null;
          draft_admin_user_id?: string | null;
          draft_created_at?: string | null;
          answer?: string | null;
          answer_message_id?: string | null;
          created_at?: string;
          answered_at?: string | null;
        };
        Update: Partial<Pick<
          ProductHelpRequest,
          | "admin_message_id"
          | "status"
          | "draft_title"
          | "draft_answer"
          | "draft_admin_user_id"
          | "draft_created_at"
          | "answer"
          | "answer_message_id"
          | "answered_at"
        >>;
        Relationships: never[];
      };
      public_memories: {
        Row: PublicMemory;
        Insert: {
          id?: string;
          category?: string;
          title: string;
          content: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Pick<PublicMemory, "category" | "title" | "content" | "updated_at">>;
        Relationships: never[];
      };
      admin_public_memory_requests: {
        Row: AdminPublicMemoryRequest;
        Insert: never;
        Update: never;
        Relationships: never[];
      };
      admin_message_feedback: {
        Row: AdminMessageFeedback;
        Insert: {
          admin_message_id: string;
          user_id?: string;
          kind: AdminMessageFeedback["kind"];
          details?: string | null;
          updated_at?: string;
        };
        Update: Partial<{
          kind: AdminMessageFeedback["kind"];
          details: string | null;
          updated_at: string;
        }>;
        Relationships: never[];
      };
      admin_message_requests: {
        Row: AdminMessageRequest;
        Insert: {
          id?: string;
          admin_user_id: string;
          recipient_user_ids: string[];
          all_accounts?: boolean;
          title: string;
          body: string;
          status?: AdminMessageRequest["status"];
          created_at?: string;
          sent_at?: string | null;
        };
        Update: never;
        Relationships: never[];
      };
      ai_reminders: {
        Row: AiReminder;
        Insert: {
          id?: string;
          user_id: string;
          source_message_id?: string | null;
          title: string;
          body: string;
          next_run_at: string;
          timezone?: "Asia/Jakarta";
          repeat_interval_seconds?: number | null;
          repeat_every?: number | null;
          repeat_unit?: AiReminder["repeat_unit"];
          active?: boolean;
          created_at?: string;
          completed_at?: string | null;
        };
        Update: Partial<Pick<AiReminder, "active" | "next_run_at" | "completed_at" | "repeat_every" | "repeat_unit">>;
        Relationships: never[];
      };
      push_subscriptions: {
        Row: {
          id: string;
          user_id: string;
          endpoint: string;
          subscription: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          endpoint: string;
          subscription: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<{
          subscription: Json;
          updated_at: string;
        }>;
        Relationships: never[];
      };
      user_settings: {
        Row: {
          user_id: string;
          supabase_url: string;
          publishable_key: string;
          display_name: string;
          custom_prompt: string;
          chat_style: string;
          tts_api_key: string;
          tts_api_keys: string[];
          tts_voice: string;
          enter_key_behavior: "system" | "submit" | "newline";
          enter_key_behavior_desktop: GeneralSettings["enter_key_behavior_desktop"];
          enter_key_behavior_mobile: GeneralSettings["enter_key_behavior_mobile"];
          time_format: GeneralSettings["time_format"];
          font_size: number;
          web_search_enabled: boolean;
          updated_at: string;
        };
        Insert: {
          user_id?: string;
          supabase_url?: string;
          publishable_key?: string;
          display_name?: string;
          custom_prompt?: string;
          chat_style?: string;
          tts_api_key?: string;
          tts_api_keys?: string[];
          tts_voice?: string;
          enter_key_behavior?: "system" | "submit" | "newline";
          enter_key_behavior_desktop?: GeneralSettings["enter_key_behavior_desktop"];
          enter_key_behavior_mobile?: GeneralSettings["enter_key_behavior_mobile"];
          time_format?: GeneralSettings["time_format"];
          font_size?: number;
          web_search_enabled?: boolean;
          updated_at?: string;
        };
        Update: Partial<{
          supabase_url: string;
          publishable_key: string;
          display_name: string;
          custom_prompt: string;
          chat_style: string;
          tts_api_key: string;
          tts_api_keys: string[];
          tts_voice: string;
          enter_key_behavior: "system" | "submit" | "newline";
          enter_key_behavior_desktop: GeneralSettings["enter_key_behavior_desktop"];
          enter_key_behavior_mobile: GeneralSettings["enter_key_behavior_mobile"];
          time_format: GeneralSettings["time_format"];
          font_size: number;
          web_search_enabled: boolean;
          updated_at: string;
        }>;
        Relationships: never[];
      };
      chat_messages: {
        Row: StoredChatMessage;
        Insert: {
          id?: string;
          user_id?: string;
          role: StoredChatMessage["role"];
          admin_message_id?: string | null;
          content: string;
          embedding?: string | null;
          created_at?: string;
          version_number?: number;
          thinking_summary?: string | null;
          is_reminder?: boolean;
          is_active?: boolean;
          revision_reason?: ChatMessageVersion["revision_reason"];
        };
        Update: Partial<{
          role: StoredChatMessage["role"];
          content: string;
          embedding: string | null;
          version_number: number;
          thinking_summary: string | null;
          is_reminder: boolean;
          is_active: boolean;
          revision_reason: ChatMessageVersion["revision_reason"];
        }>;
        Relationships: never[];
      };
      chat_message_versions: {
        Row: ChatMessageVersion;
        Insert: {
          id?: string;
          user_id?: string;
          message_id: string;
          version_number: number;
          source_message_id?: string | null;
          source_message_version_number?: number | null;
          content: string;
          embedding?: string | null;
          thinking_summary?: string | null;
          revision_reason: ChatMessageVersion["revision_reason"];
          created_at?: string;
        };
        Update: Partial<{
          embedding: string | null;
        }>;
        Relationships: never[];
      };
      chat_conversation_branches: {
        Row: {
          id: string;
          user_id: string;
          anchor_message_id: string;
          anchor_version_number: number;
          messages: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string;
          anchor_message_id: string;
          anchor_version_number: number;
          messages: Json;
          created_at?: string;
        };
        Update: Partial<{
          messages: Json;
        }>;
        Relationships: never[];
      };
      chat_message_jobs: {
        Row: ChatMessageJob;
        Insert: {
          id?: string;
          user_id?: string;
          message_id: string;
          assistant_message_id?: string | null;
          thinking_mode?: boolean;
          status?: ChatJobStatus;
          progress?: string;
          error?: string | null;
          created_at?: string;
          updated_at?: string;
          completed_at?: string | null;
        };
        Update: Partial<{
          assistant_message_id: string | null;
          status: ChatJobStatus;
          progress: string;
          error: string | null;
          updated_at: string;
          completed_at: string | null;
        }>;
        Relationships: never[];
      };
      chat_message_attachments: {
        Row: ChatAttachment & {
          storage_path: string;
          sha256: string | null;
          identity_sha256: string | null;
          show_text: boolean;
        };
        Insert: {
          id?: string;
          user_id?: string;
          message_id?: string | null;
          storage_path: string;
          sha256?: string | null;
          identity_sha256?: string | null;
          show_text?: boolean;
          file_name: string;
          mime_type: string;
          size_bytes: number;
          created_at?: string;
          expires_at?: string;
          deleted_at?: string | null;
        };
        Update: Partial<{
          message_id: string | null;
          sha256: string | null;
          identity_sha256: string | null;
          deleted_at: string | null;
        }>;
        Relationships: never[];
      };
      chat_message_attachment_links: {
        Row: {
          message_id: string;
          attachment_id: string;
          created_at: string;
        };
        Insert: {
          message_id: string;
          attachment_id: string;
          created_at?: string;
        };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "chat_message_attachment_links_attachment_id_fkey";
            columns: ["attachment_id"];
            isOneToOne: false;
            referencedRelation: "chat_message_attachments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "chat_message_attachment_links_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "chat_messages";
            referencedColumns: ["id"];
          },
        ];
      };
      chat_tts_audio_cache: {
        Row: GeminiTtsAudioCache;
        Insert: {
          id?: string;
          user_id?: string;
          message_id: string;
          version_number: number;
          voice: GeminiTtsVoice | "id-ID";
          storage_path: string;
          source?: "gemini" | "soundoftext";
          created_at?: string;
          expires_at?: string;
        };
        Update: Partial<Pick<GeminiTtsAudioCache, "expires_at">>;
        Relationships: never[];
      };
      account_sessions: {
        Row: AccountSession;
        Insert: {
          id: string;
          user_id: string;
          origin: string;
          path: string;
          user_agent?: string;
          started_at?: string;
          last_seen_at?: string;
          is_active?: boolean;
        };
        Update: Partial<
          Pick<AccountSession, "origin" | "path" | "user_agent" | "last_seen_at" | "is_active">
        >;
        Relationships: never[];
      };
      message_insights: {
        Row: MessageInsight;
        Insert: {
          id?: string;
          user_id?: string;
          message_id: string;
          mood?: string;
          communication_style?: string;
          situation?: string;
          topics?: string[];
          support_needs?: string;
          summary?: string;
          embedding?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          mood: string;
          communication_style: string;
          situation: string;
          topics: string[];
          support_needs: string;
          summary: string;
          embedding: string | null;
        }>;
        Relationships: never[];
      };
      user_memories: {
        Row: UserMemory;
        Insert: {
          id?: string;
          user_id?: string;
          source_message_id?: string | null;
          category?: string;
          content: string;
          embedding?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<{
          category: string;
          content: string;
          source_message_id: string | null;
          embedding: string | null;
          updated_at: string;
        }>;
        Relationships: never[];
      };
      message_feedback: {
        Row: MessageFeedback;
        Insert: {
          id?: string;
          user_id?: string;
          message_id: string;
          version_number?: number;
          kind: MessageFeedback["kind"];
          details?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          kind: MessageFeedback["kind"];
          details: string | null;
        }>;
        Relationships: never[];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      relay_user_message_to_admin: {
        Args: { p_sender_user_id: string; p_body: string; p_source_message_id: string };
        Returns: string;
      };
      update_admin_message_relay: {
        Args: { p_admin_message_id: string; p_body: string };
        Returns: number;
      };
      finalize_admin_message_request: {
        Args: { p_request_id: string; p_approve: boolean };
        Returns: number;
      };
      deliver_ai_reminder: {
        Args: { p_reminder_id: string; p_scheduled_at: string };
        Returns: Array<{
          user_id: string;
          title: string;
          body: string;
          next_run_at: string | null;
        }>;
      };
      import_account_data: {
        Args: { p_data: Json };
        Returns: {
          imported: number;
        }[];
      };
      set_message_rating: {
        Args: {
          p_message_id: string;
          p_version_number: number;
          p_rating: "like" | "dislike" | null;
        };
        Returns: undefined;
      };
      clear_chat_history: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      request_product_help_from_admin: {
        Args: {
          p_user_id: string;
          p_source_message_id: string;
          p_question: string;
        };
        Returns: Array<{
          request_id: string;
          admin_message_id: string;
          was_existing: boolean;
        }>;
      };
      prepare_product_help_answer: {
        Args: {
          p_admin_user_id: string;
          p_request_id: string;
          p_title: string;
          p_answer: string;
        };
        Returns: Array<{
          request_id: string;
          draft_title: string;
          draft_answer: string;
          draft_created_at: string;
        }>;
      };
      confirm_product_help_answer: {
        Args: {
          p_admin_user_id: string;
          p_request_id: string;
          p_confirmation_message_id: string;
        };
        Returns: Array<{
          user_id: string;
          answer_message_id: string;
          was_existing: boolean;
          answer: string;
        }>;
      };
      search_product_help_memories: {
        Args: {
          p_query: string;
          p_limit?: number;
        };
        Returns: Array<{
          title: string;
          content: string;
        }>;
      };
      start_admin_public_memory_request: {
        Args: {
          p_admin_user_id: string;
          p_source_message_id: string;
          p_question: string;
        };
        Returns: Array<{ request_id: string; was_existing: boolean }>;
      };
      search_admin_public_memory_requests: {
        Args: { p_admin_user_id: string; p_query: string };
        Returns: Array<{
          id: string;
          question: string;
          status: AdminPublicMemoryRequest["status"];
          draft_title: string | null;
          draft_content: string | null;
          created_at: string;
        }>;
      };
      prepare_admin_public_memory: {
        Args: {
          p_admin_user_id: string;
          p_request_id: string;
          p_title: string;
          p_content: string;
        };
        Returns: Array<{
          request_id: string;
          draft_title: string;
          draft_content: string;
          draft_updated_at: string;
        }>;
      };
      confirm_admin_public_memory: {
        Args: {
          p_admin_user_id: string;
          p_request_id: string;
          p_confirmation_message_id: string;
        };
        Returns: Array<{
          public_memory_id: string;
          title: string;
          content: string;
          was_existing: boolean;
        }>;
      };
      delete_chat_branch_from_message: {
        Args: { p_message_id: string };
        Returns: number;
      };
      run_database_keepalive: {
        Args: Record<PropertyKey, never>;
        Returns: Array<{
          pinged: boolean;
          idle_days: number;
          last_activity_at: string;
          last_keepalive_at: string | null;
        }>;
      };
      revise_chat_message: {
        Args: {
          p_message_id: string;
          p_content: string;
          p_embedding: string | null;
          p_thinking_summary: string | null;
          p_revision_reason: ChatMessageVersion["revision_reason"];
          p_branch: boolean;
          p_user_id?: string | null;
          p_source_message_id?: string | null;
          p_source_message_version_number?: number | null;
        };
        Returns: StoredChatMessage[];
      };
      restore_chat_branch: {
        Args: {
          p_anchor_message_id: string;
          p_anchor_version_number: number;
        };
        Returns: StoredChatMessage[];
      };
      save_chat_branch: {
        Args: {
          p_anchor_message_id: string;
          p_anchor_version_number: number;
        };
        Returns: undefined;
      };
      create_chat_job: {
        Args: { p_content: string; p_thinking_mode: boolean };
        Returns: Array<{ job_id: string; message_id: string }>;
      };
      create_chat_job_with_attachments: {
        Args: {
          p_content: string;
          p_thinking_mode: boolean;
          p_attachment_ids: string[];
          p_client_request_id: string;
        };
        Returns: Array<{ job_id: string; message_id: string; created: boolean }>;
      };
      save_chat_voice_note_transcript: {
        Args: { p_message_id: string; p_content: string };
        Returns: number;
      };
      register_chat_attachment_reference: {
        Args: {
          p_id: string;
          p_user_id: string;
          p_sha256: string;
          p_identity_sha256: string;
          p_storage_path: string | null;
          p_file_name: string;
          p_mime_type: string;
          p_size_bytes: number;
        };
        Returns: Array<ChatAttachment & { storage_path: string; reused: boolean }>;
      };
      release_chat_attachment_reference: {
        Args: {
          p_attachment_id: string;
          p_user_id: string;
          p_expired_only?: boolean;
        };
        Returns: Array<{ storage_path: string | null; should_delete: boolean }>;
      };
      purge_released_chat_attachment_references: {
        Args: { p_user_id: string; p_storage_path: string };
        Returns: boolean;
      };
      complete_chat_job: {
        Args: {
          p_job_id: string;
          p_content: string;
          p_embedding: string | null;
          p_thinking_summary: string | null;
          p_admin_message_id?: string | null;
        };
        Returns: StoredChatMessage[];
      };
      match_chat_messages_for_user: {
        Args: {
          p_user_id: string;
          query_embedding: string;
          result_limit?: number;
          exclude_message_id?: string | null;
        };
        Returns: Array<{
          id: string;
          role: StoredChatMessage["role"];
          content: string;
          created_at: string;
          similarity: number;
        }>;
      };
      match_chat_messages_before_for_user: {
        Args: {
          p_user_id: string;
          query_embedding: string;
          max_created_at: string;
          result_limit?: number;
          exclude_message_id?: string | null;
        };
        Returns: Array<{
          id: string;
          role: StoredChatMessage["role"];
          content: string;
          created_at: string;
          similarity: number;
        }>;
      };
      match_user_memories_for_user: {
        Args: {
          p_user_id: string;
          query_embedding: string;
          result_limit?: number;
        };
        Returns: Array<{
          id: string;
          category: string;
          content: string;
          similarity: number;
        }>;
      };
      match_message_insights_for_user: {
        Args: {
          p_user_id: string;
          query_embedding: string;
          result_limit?: number;
        };
        Returns: Array<{
          message_id: string;
          mood: string;
          communication_style: string;
          situation: string;
          topics: string[];
          support_needs: string;
          summary: string;
          created_at: string;
          similarity: number;
        }>;
      };
      match_chat_messages: {
        Args: {
          query_embedding: string;
          result_limit?: number;
          exclude_message_id?: string | null;
        };
        Returns: Array<{
          id: string;
          role: StoredChatMessage["role"];
          content: string;
          created_at: string;
          similarity: number;
        }>;
      };
      match_chat_messages_before: {
        Args: {
          query_embedding: string;
          max_created_at: string;
          result_limit?: number;
          exclude_message_id?: string | null;
        };
        Returns: Array<{
          id: string;
          role: StoredChatMessage["role"];
          content: string;
          created_at: string;
          similarity: number;
        }>;
      };
      match_user_memories: {
        Args: { query_embedding: string; result_limit?: number };
        Returns: Array<{
          id: string;
          category: string;
          content: string;
          similarity: number;
        }>;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

export type AppSupabaseClient = SupabaseClient<Database, "public">;

const clients = new Map<string, AppSupabaseClient>();
const pendingSessions = new WeakMap<AppSupabaseClient, Promise<void>>();
const pendingImports = new WeakMap<AppSupabaseClient, Promise<void>>();
const ACCOUNT_MIGRATION_DB = "cheyaverse-account-migration";
const ACCOUNT_MIGRATION_STORE = "snapshots";
const ACCOUNT_MIGRATION_KEY = "pending";
const ACCOUNT_MIGRATION_MARKER = "cheyaverse.account-migration.pending";

function openMigrationStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(ACCOUNT_MIGRATION_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(ACCOUNT_MIGRATION_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open account migration storage."));
  });
}

async function readMigrationSnapshot(): Promise<AccountDataSnapshot | null> {
  if (!window.localStorage.getItem(ACCOUNT_MIGRATION_MARKER)) return null;
  const db = await openMigrationStore();
  return new Promise((resolve, reject) => {
    const request = db
      .transaction(ACCOUNT_MIGRATION_STORE, "readonly")
      .objectStore(ACCOUNT_MIGRATION_STORE)
      .get(ACCOUNT_MIGRATION_KEY);
    request.onsuccess = () => {
      db.close();
      const snapshot = (request.result as AccountDataSnapshot | undefined) ?? null;
      if (!snapshot) window.localStorage.removeItem(ACCOUNT_MIGRATION_MARKER);
      resolve(snapshot);
    };
    request.onerror = () => {
      db.close();
      reject(request.error ?? new Error("Could not read saved account migration data."));
    };
  });
}

async function writeMigrationSnapshot(snapshot: AccountDataSnapshot | null): Promise<void> {
  const db = await openMigrationStore();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(ACCOUNT_MIGRATION_STORE, "readwrite");
    const store = transaction.objectStore(ACCOUNT_MIGRATION_STORE);
    if (snapshot) store.put(snapshot, ACCOUNT_MIGRATION_KEY);
    else store.delete(ACCOUNT_MIGRATION_KEY);
    transaction.oncomplete = () => {
      try {
        if (snapshot) window.localStorage.setItem(ACCOUNT_MIGRATION_MARKER, "1");
        else window.localStorage.removeItem(ACCOUNT_MIGRATION_MARKER);
        resolve();
      } catch (error) {
        reject(
          new Error(
            `Could not update account migration status: ${
              error instanceof Error ? error.message : "browser storage is unavailable."
            }`,
          ),
        );
      }
    };
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Could not save account migration data."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Account migration storage was interrupted."));
  }).finally(() => db.close());
}

function mergeAccountSnapshots(
  previous: AccountDataSnapshot | null,
  current: AccountDataSnapshot,
): AccountDataSnapshot {
  if (!previous) return current;
  const mergeById = <T extends { id: string }>(oldRows: T[], newRows: T[]) =>
    [...new Map([...oldRows, ...newRows].map((row) => [row.id, row])).values()];
  const settings = [previous.user_settings, current.user_settings]
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((left, right) => left.updated_at.localeCompare(right.updated_at))
    .slice(-1)[0] ?? null;
  return {
    user_settings: settings,
    ai_api_keys: mergeById(previous.ai_api_keys, current.ai_api_keys),
    chat_messages: mergeById(previous.chat_messages, current.chat_messages),
    chat_message_versions: mergeById(
      previous.chat_message_versions,
      current.chat_message_versions,
    ),
    message_insights: mergeById(previous.message_insights, current.message_insights),
    user_memories: mergeById(previous.user_memories, current.user_memories),
    message_feedback: mergeById(previous.message_feedback, current.message_feedback),
  };
}

async function loadAllRows<T>(
  loadPage: (
    start: number,
    end: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await loadPage(start, start + 999);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

async function exportAccountData(client: AppSupabaseClient): Promise<AccountDataSnapshot> {
  const [
    settingsResult,
    aiApiKeys,
    chatMessages,
    chatMessageVersions,
    messageInsights,
    userMemories,
    messageFeedback,
  ] = await Promise.all([
    client.from("user_settings").select("*").maybeSingle(),
    loadAllRows((start, end) =>
      client.from("ai_api_keys").select("*").order("id").range(start, end),
    ),
    loadAllRows((start, end) =>
      client.from("chat_messages").select("*").order("id").range(start, end),
    ),
    loadAllRows((start, end) =>
      client.from("chat_message_versions").select("*").order("id").range(start, end),
    ),
    loadAllRows((start, end) =>
      client.from("message_insights").select("*").order("id").range(start, end),
    ),
    loadAllRows((start, end) =>
      client.from("user_memories").select("*").order("id").range(start, end),
    ),
    loadAllRows((start, end) =>
      client.from("message_feedback").select("*").order("id").range(start, end),
    ),
  ]);
  if (settingsResult.error) {
    throw new Error(`Could not export account settings: ${settingsResult.error.message}`);
  }
  return {
    user_settings: settingsResult.data,
    ai_api_keys: aiApiKeys,
    chat_messages: chatMessages,
    chat_message_versions: chatMessageVersions,
    message_insights: messageInsights,
    user_memories: userMemories,
    message_feedback: messageFeedback,
  };
}

async function importAccountSnapshot(
  client: AppSupabaseClient,
  snapshot: AccountDataSnapshot,
): Promise<void> {
  const emptySnapshot: AccountDataSnapshot = {
    user_settings: null,
    ai_api_keys: [],
    chat_messages: [],
    chat_message_versions: [],
    message_insights: [],
    user_memories: [],
    message_feedback: [],
  };
  const importChunk = async (data: AccountDataSnapshot) => {
    const { error } = await client.rpc("import_account_data", { p_data: data });
    if (error) throw error;
  };

  await importChunk({
    ...emptySnapshot,
    user_settings: snapshot.user_settings
      ? { ...snapshot.user_settings, supabase_url: "", publishable_key: "" }
      : null,
    ai_api_keys: snapshot.ai_api_keys,
  });
  const chunkSize = 100;
  const importRows = async <K extends Exclude<keyof AccountDataSnapshot, "user_settings">>(
    key: K,
    rows: AccountDataSnapshot[K],
  ) => {
    for (let start = 0; start < rows.length; start += chunkSize) {
      await importChunk({
        ...emptySnapshot,
        [key]: rows.slice(start, start + chunkSize),
      });
    }
  };
  await importRows("user_memories", snapshot.user_memories);
  await importRows("chat_messages", snapshot.chat_messages);
  await importRows("chat_message_versions", snapshot.chat_message_versions);
  await importRows("message_insights", snapshot.message_insights);
  await importRows("message_feedback", snapshot.message_feedback);
}

async function importPendingAccountData(client: AppSupabaseClient): Promise<void> {
  const pendingImport = pendingImports.get(client);
  if (pendingImport) return pendingImport;

  const importAttempt = (async () => {
    const snapshot = await readMigrationSnapshot();
    if (!snapshot) return;
    const { data, error } = await client.auth.getUser();
    if (error) throw error;
    if (!data.user || data.user.is_anonymous) return;

    try {
      await importAccountSnapshot(client, snapshot);
    } catch (error) {
      throw new Error(
        `Your account is connected, but existing browser data could not be imported. Run the latest supabase/schema.sql and retry. ${
          error instanceof Error ? error.message : "Unknown database error."
        }`,
      );
    }
    await writeMigrationSnapshot(null);
    window.localStorage.removeItem(DATABASE_CONFIG_KEY);
  })();

  pendingImports.set(client, importAttempt);
  return importAttempt.finally(() => {
    pendingImports.delete(client);
  });
}

async function prepareLegacyAccountDataMigration(): Promise<void> {
  const legacyConfig = loadLegacyDatabaseConfig();
  if (!legacyConfig) return;

  const legacyClient = createSupabaseClient(legacyConfig);
  await ensureAnonymousSession(legacyClient);
  const exported = await exportAccountData(legacyClient);
  const previous = await readMigrationSnapshot();
  await writeMigrationSnapshot(mergeAccountSnapshots(previous, exported));
}

export async function signInWithGoogle(
  client: AppSupabaseClient,
  googleIdToken: string,
  captchaToken: string,
): Promise<void> {
  await prepareLegacyAccountDataMigration();

  setPendingAuthProvider("google");
  const { error } = await client.auth.signInWithIdToken({
    provider: "google",
    token: googleIdToken,
    options: { captchaToken },
  });
  if (error) {
    clearPendingAuthProvider();
    throw error;
  }

  try {
    await importPendingAccountData(client);
  } catch (importError) {
    const { error: signOutError } = await client.auth.signOut({ scope: "local" });
    clearPendingAuthProvider();
    if (signOutError) {
      throw new Error(
        `Existing data could not be imported, and sign-out failed: ${
          importError instanceof Error ? importError.message : "Unknown import error."
        } ${signOutError.message}`,
      );
    }
    throw importError;
  }
}

export async function signInWithGithub(client: AppSupabaseClient): Promise<void> {
  await prepareLegacyAccountDataMigration();
  setPendingAuthProvider("github");
  const { error } = await client.auth.signInWithOAuth({
    provider: "github",
    options: {
      redirectTo: window.location.origin,
      scopes: "read:user",
    },
  });
  if (error) {
    clearPendingAuthProvider();
    throw error;
  }
}

export function loadDatabaseConfig(): DatabaseConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const publishableKey =
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  return url && publishableKey ? { url, publishableKey } : null;
}

function loadLegacyDatabaseConfig(): DatabaseConfig | null {
  const stored = window.localStorage.getItem(DATABASE_CONFIG_KEY);
  if (!stored) return null;
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    throw new Error("The old browser database settings are invalid; they could not be migrated.");
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !("url" in value) ||
    !("publishableKey" in value) ||
    typeof value.url !== "string" ||
    typeof value.publishableKey !== "string" ||
    !value.url ||
    !value.publishableKey
  ) {
    throw new Error("The old browser database settings are incomplete; they could not be migrated.");
  }
  return { url: value.url, publishableKey: value.publishableKey };
}

export function createSupabaseClient(config: DatabaseConfig): AppSupabaseClient {
  const cacheKey = JSON.stringify([config.url, config.publishableKey]);
  const cachedClient = clients.get(cacheKey);
  if (cachedClient) return cachedClient;

  const client = createClient<Database, "public">(config.url, config.publishableKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      flowType: "pkce",
    },
  });
  clients.set(cacheKey, client);
  return client;
}

export function ensureSupabaseSession(client: AppSupabaseClient): Promise<void> {
  const pendingSession = pendingSessions.get(client);
  if (pendingSession) return pendingSession;

  const sessionAttempt = (async () => {
    const {
      data: { session },
      error: sessionError,
    } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    if (!session?.user || session.user.is_anonymous) {
      throw new Error("Sign in with your account before using CheyaVerse.");
    }
    await importPendingAccountData(client);
  })();

  pendingSessions.set(client, sessionAttempt);
  return sessionAttempt.finally(() => {
    pendingSessions.delete(client);
  });
}

async function ensureAnonymousSession(client: AppSupabaseClient): Promise<void> {
  const {
    data: { session },
    error: sessionError,
  } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  if (session) return;
  const { error } = await client.auth.signInAnonymously();
  if (error) {
    throw new Error(
      `Could not read the previous browser database for migration: ${error.message}`,
    );
  }
}

export async function saveApiStatus(
  client: AppSupabaseClient,
  attempt: { keyId: string; status: Exclude<ApiStatus, "untested">; error: string | null },
  userId?: string,
): Promise<void> {
  let query = client
    .from("ai_api_keys")
    .update({
      status: attempt.status,
      last_error: attempt.error,
    })
    .eq("id", attempt.keyId);
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query.select("id");

  if (error) throw error;
  if (data.length === 0) {
    throw new Error("Could not update the API status. Check your database table and RLS policies.");
  }
}
