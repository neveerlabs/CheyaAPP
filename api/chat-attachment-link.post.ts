import { createError, defineEventHandler, getHeader, readBody } from "nitro/h3";
import { CHAT_ATTACHMENT_BUCKET } from "../src/lib/chat-attachments";
import { createAuthenticatedServerClient, createServiceRoleClient } from "../src/lib/server-supabase";

export default defineEventHandler(async (event) => {
  const accessToken = getHeader(event, "authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) {
    throw createError({ statusCode: 401, statusMessage: "Sign in before opening this attachment." });
  }

  const requestClient = createAuthenticatedServerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await requestClient.auth.getUser(accessToken);
  if (authError || !user || user.is_anonymous) {
    throw createError({ statusCode: 401, statusMessage: "Your account session is invalid or expired." });
  }

  const body = await readBody<{ id?: unknown }>(event);
  if (typeof body?.id !== "string") {
    throw createError({ statusCode: 400, statusMessage: "Attachment ID is required." });
  }

  const serviceClient = createServiceRoleClient();
  const { data: attachment, error: attachmentError } = await serviceClient
    .from("chat_message_attachments")
    .select("storage_path, expires_at, deleted_at")
    .eq("id", body.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (attachmentError) {
    throw createError({
      statusCode: 500,
      statusMessage: `Could not load attachment: ${attachmentError.message}`,
    });
  }
  if (!attachment) {
    throw createError({ statusCode: 404, statusMessage: "Attachment was not found." });
  }

  const secondsUntilExpiry = Math.floor((Date.parse(attachment.expires_at) - Date.now()) / 1000);
  if (attachment.deleted_at || secondsUntilExpiry <= 0) {
    throw createError({ statusCode: 410, statusMessage: "This attachment expired after 24 hours." });
  }

  const { data, error } = await serviceClient.storage
    .from(CHAT_ATTACHMENT_BUCKET)
    .createSignedUrl(attachment.storage_path, Math.min(secondsUntilExpiry, 60));
  if (error) {
    throw createError({
      statusCode: 502,
      statusMessage: `Could not open attachment: ${error.message}`,
    });
  }
  return { signedUrl: data.signedUrl };
});
