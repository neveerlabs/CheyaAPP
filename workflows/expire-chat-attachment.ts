import { sleep } from "workflow";
import { releaseStoredChatAttachment } from "../src/lib/chat-data";
import { createServiceRoleClient } from "../src/lib/server-supabase";

async function loadAttachmentExpiry(attachmentId: string): Promise<{
  expiresAt: string;
  userId: string;
} | null> {
  "use step";
  const client = createServiceRoleClient();
  const { data, error } = await client
    .from("chat_message_attachments")
    .select("expires_at, user_id")
    .eq("id", attachmentId)
    .maybeSingle();
  if (error) throw new Error(`Could not load attachment expiry: ${error.message}`);
  if (!data) return null;
  return { expiresAt: data.expires_at, userId: data.user_id };
}

async function deleteExpiredAttachment(attachmentId: string, userId: string): Promise<void> {
  "use step";
  await releaseStoredChatAttachment(createServiceRoleClient(), attachmentId, userId, true);
}

export async function expireChatAttachmentWorkflow(attachmentId: string): Promise<void> {
  "use workflow";
  const attachment = await loadAttachmentExpiry(attachmentId);
  if (!attachment) return;
  await sleep(new Date(attachment.expiresAt));
  await deleteExpiredAttachment(attachmentId, attachment.userId);
}
