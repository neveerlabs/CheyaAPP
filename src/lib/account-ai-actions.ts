import type { AppSupabaseClient } from "./supabase";

export const ACCOUNT_AI_ACTION_NAMES = new Set([
  "send_message_to_admin",
  "search_all_account_data",
  "share_chat_attachment",
  "prepare_admin_message",
  "forward_user_attachment_to_admin",
  "create_reminder",
  "search_reminders",
  "cancel_reminder",
  "send_push_notification",
]);

export async function executeAccountAiActionFromClient(
  client: AppSupabaseClient,
  name: string,
  input: unknown,
  sourceMessageId?: string,
): Promise<unknown> {
  const {
    data: { session },
    error: sessionError,
  } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  if (!session?.access_token) {
    throw new Error("Your account session has expired. Sign in again.");
  }
  const response = await fetch("/api/account-ai-action", {
    method: "POST",
    headers: {
      Authorization: ["Bearer", session.access_token].join(" "),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, input, sourceMessageId }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "statusMessage" in payload &&
      typeof payload.statusMessage === "string"
        ? payload.statusMessage
        : `Account AI action failed (${response.status}).`;
    throw new Error(message);
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("result" in payload)
  ) {
    throw new Error("The account AI service returned an invalid result.");
  }
  return payload.result;
}

export async function reportAiFailureFromClient(
  client: AppSupabaseClient,
  message: string,
): Promise<void> {
  const {
    data: { session },
    error: sessionError,
  } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  if (!session?.access_token) throw new Error("Your account session has expired. Sign in again.");

  const response = await fetch("/api/account-ai-error", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const statusMessage =
      typeof payload === "object" &&
      payload !== null &&
      "statusMessage" in payload &&
      typeof payload.statusMessage === "string"
        ? payload.statusMessage
        : `Could not save the AI error to your inbox (${response.status}).`;
    throw new Error(statusMessage);
  }
}

export async function linkChatAttachmentsFromClient(
  client: AppSupabaseClient,
  messageId: string,
  attachmentIds: string[],
): Promise<void> {
  const {
    data: { session },
    error: sessionError,
  } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  if (!session?.access_token) throw new Error("Your account session has expired. Sign in again.");

  const response = await fetch("/api/chat-message-attachments", {
    method: "POST",
    headers: {
      Authorization: ["Bearer", session.access_token].join(" "),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messageId, attachmentIds }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const statusMessage =
      typeof payload === "object" &&
      payload !== null &&
      "statusMessage" in payload &&
      typeof payload.statusMessage === "string"
        ? payload.statusMessage
        : `Could not attach files to the AI message (${response.status}).`;
    throw new Error(statusMessage);
  }
}
