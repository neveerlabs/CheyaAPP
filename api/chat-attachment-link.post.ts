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
    .select("user_id, storage_path, expires_at, deleted_at")
    .eq("id", body.id)
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

  if (attachment.user_id !== user.id) {
    const { data: profile, error: profileError } = await serviceClient
      .from("account_profiles")
      .select("role")
      .eq("user_id", user.id)
      .single();
    if (profileError) {
      throw createError({ statusCode: 500, statusMessage: `Could not verify account role: ${profileError.message}` });
    }
    if (profile.role !== "admin") {
      throw createError({ statusCode: 403, statusMessage: "Only administrators may open another account's shared attachment." });
    }
    const { data: links, error: linksError } = await serviceClient
      .from("chat_message_attachment_links")
      .select("message_id")
      .eq("attachment_id", body.id);
    if (linksError) {
      throw createError({ statusCode: 500, statusMessage: `Could not verify the shared attachment: ${linksError.message}` });
    }
    const messageIds = links.map((link) => link.message_id);
    const { data: messages, error: messagesError } = messageIds.length
      ? await serviceClient
          .from("chat_messages")
          .select("id")
          .in("id", messageIds)
          .eq("user_id", user.id)
          .limit(1)
      : { data: [], error: null };
    if (messagesError) {
      throw createError({ statusCode: 500, statusMessage: `Could not verify the shared chat message: ${messagesError.message}` });
    }
    if (messages.length === 0) {
      throw createError({ statusCode: 403, statusMessage: "This attachment is not shared in your chat." });
    }
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
