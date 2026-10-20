import type { AccountRole, AppSupabaseClient } from "./supabase";

const uuidPattern = /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

export async function linkChatAttachments(
  client: AppSupabaseClient,
  userId: string,
  role: AccountRole,
  messageId: string,
  attachmentIds: string[],
): Promise<void> {
  if (!uuidPattern.test(messageId)) throw new Error("The target chat message ID is invalid.");
  const ids = [...new Set(attachmentIds)];
  if (ids.length > 10 || ids.some((id) => !uuidPattern.test(id))) {
    throw new Error("Attachment IDs are invalid.");
  }
  if (ids.length === 0) return;

  const { data: message, error: messageError } = await client
    .from("chat_messages")
    .select("id")
    .eq("id", messageId)
    .eq("user_id", userId)
    .maybeSingle();
  if (messageError) throw new Error(`Could not verify the chat message: ${messageError.message}`);
  if (!message) throw new Error("The target chat message does not belong to this account.");

  const { data: attachments, error: attachmentError } = await client
    .from("chat_message_attachments")
    .select("id, user_id, message_id")
    .in("id", ids)
    .not("message_id", "is", null)
    .is("deleted_at", null)
    .gt("expires_at", new Date().toISOString());
  if (attachmentError) {
    throw new Error(`Could not validate shared attachments: ${attachmentError.message}`);
  }
  const validAttachments =
    role === "admin" ? attachments : attachments.filter((attachment) => attachment.user_id === userId);
  if (validAttachments.length !== ids.length) {
    throw new Error("One or more attachments are expired, unavailable, or not allowed for this account.");
  }

  const { error: linkError } = await client
    .from("chat_message_attachment_links")
    .upsert(
      ids.map((attachmentId) => ({ message_id: messageId, attachment_id: attachmentId })),
      { onConflict: "message_id,attachment_id", ignoreDuplicates: true },
    );
  if (linkError) throw new Error(`Could not attach shared files to the AI message: ${linkError.message}`);
}

export function getSharedAttachmentId(result: unknown): string | null {
  if (
    typeof result !== "object" ||
    result === null ||
    !("attachmentId" in result) ||
    typeof result.attachmentId !== "string" ||
    !uuidPattern.test(result.attachmentId)
  ) {
    return null;
  }
  return result.attachmentId;
}
