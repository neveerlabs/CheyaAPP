import { createError, defineEventHandler, getHeader, readBody } from "nitro/h3";
import { CHAT_ATTACHMENT_BUCKET } from "../src/lib/chat-attachments";
import { createAuthenticatedServerClient, createServiceRoleClient } from "../src/lib/server-supabase";

export default defineEventHandler(async (event) => {
  const authorization = getHeader(event, "authorization");
  const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) {
    throw createError({ statusCode: 401, statusMessage: "Sign in before opening a forwarded file." });
  }

  const authClient = createAuthenticatedServerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser(accessToken);
  if (authError || !user || user.is_anonymous) {
    throw createError({ statusCode: 401, statusMessage: "Your account session is invalid or expired." });
  }

  const body = await readBody<{ messageId?: unknown }>(event);
  if (
    !body ||
    typeof body.messageId !== "string" ||
    !/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(body.messageId)
  ) {
    throw createError({ statusCode: 400, statusMessage: "A valid forwarded message ID is required." });
  }

  const client = createServiceRoleClient();
  const { data: profile, error: profileError } = await client
    .from("account_profiles")
    .select("role")
    .eq("user_id", user.id)
    .single();
  if (profileError) throw createError({ statusCode: 500, statusMessage: `Could not verify account role: ${profileError.message}` });
  if (profile.role !== "admin") {
    throw createError({ statusCode: 403, statusMessage: "Only administrators can open forwarded user files." });
  }

  const { data: message, error: messageError } = await client
    .from("admin_messages")
    .select("sender_user_id, attachment_id")
    .eq("id", body.messageId)
    .maybeSingle();
  if (messageError) throw createError({ statusCode: 500, statusMessage: `Could not verify forwarded message: ${messageError.message}` });
  if (!message?.attachment_id) {
    throw createError({ statusCode: 404, statusMessage: "This message does not contain a forwarded file." });
  }

  const { data: attachment, error: attachmentError } = await client
    .from("chat_message_attachments")
    .select("storage_path, file_name, expires_at")
    .eq("id", message.attachment_id)
    .eq("user_id", message.sender_user_id)
    .is("deleted_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (attachmentError) {
    throw createError({ statusCode: 500, statusMessage: `Could not verify forwarded file: ${attachmentError.message}` });
  }
  if (!attachment) throw createError({ statusCode: 410, statusMessage: "This forwarded file has expired or was removed." });

  const secondsUntilExpiry = Math.floor((Date.parse(attachment.expires_at) - Date.now()) / 1000);
  const { data: signedFile, error: signedFileError } = await client.storage
    .from(CHAT_ATTACHMENT_BUCKET)
    .createSignedUrl(attachment.storage_path, Math.min(300, secondsUntilExpiry));
  if (signedFileError) {
    throw createError({ statusCode: 500, statusMessage: `Could not create a private file link: ${signedFileError.message}` });
  }
  return { fileName: attachment.file_name, url: signedFile.signedUrl };
});
