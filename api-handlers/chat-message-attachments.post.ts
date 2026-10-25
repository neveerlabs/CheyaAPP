import { createError, defineEventHandler, getHeader, readBody } from "nitro/h3";
import { linkChatAttachments } from "../src/lib/chat-attachment-sharing";
import { createAuthenticatedServerClient, createServiceRoleClient } from "../src/lib/server-supabase";

const uuidPattern = /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

export default defineEventHandler(async (event) => {
  const accessToken = getHeader(event, "authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) {
    throw createError({ statusCode: 401, statusMessage: "Sign in before sharing chat attachments." });
  }

  const authClient = createAuthenticatedServerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser(accessToken);
  if (authError || !user || user.is_anonymous) {
    throw createError({ statusCode: 401, statusMessage: "Your account session is invalid or expired." });
  }

  const body = await readBody<{
    messageId?: unknown;
    attachmentIds?: unknown;
    showText?: unknown;
  }>(event);
  if (
    typeof body?.messageId !== "string" ||
    !uuidPattern.test(body.messageId) ||
    !Array.isArray(body.attachmentIds) ||
    body.attachmentIds.length > 10 ||
    body.attachmentIds.some((id) => typeof id !== "string" || !uuidPattern.test(id)) ||
    (body.showText !== undefined && typeof body.showText !== "boolean")
  ) {
    throw createError({ statusCode: 400, statusMessage: "Chat message or attachment IDs are invalid." });
  }

  const client = createServiceRoleClient();
  const { data: profile, error: profileError } = await client
    .from("account_profiles")
    .select("role")
    .eq("user_id", user.id)
    .single();
  if (profileError) {
    throw createError({ statusCode: 500, statusMessage: `Could not verify account role: ${profileError.message}` });
  }
  if (profile.role !== "admin" && profile.role !== "user") {
    throw createError({ statusCode: 403, statusMessage: "This account role cannot share attachments." });
  }

  try {
    if (typeof body.showText === "boolean") {
      const { data: message, error: messageError } = await client
        .from("chat_messages")
        .select("id, role")
        .eq("id", body.messageId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (messageError) throw new Error(`Could not verify the assistant message: ${messageError.message}`);
      if (!message || message.role !== "assistant") {
        throw new Error("The target assistant message does not belong to this account.");
      }
      if (body.attachmentIds.length === 0) return { linked: true };

      const attachmentIds = body.attachmentIds as string[];
      const { data: attachments, error: attachmentsError } = await client
        .from("chat_message_attachments")
        .select("id, mime_type, message_id")
        .eq("user_id", user.id)
        .in("id", attachmentIds)
        .is("deleted_at", null)
        .gt("expires_at", new Date().toISOString());
      if (attachmentsError) {
        throw new Error(`Could not validate the generated voice note: ${attachmentsError.message}`);
      }
      if (
        attachments.length !== attachmentIds.length ||
        attachments.some(
          (attachment) =>
            !attachment.mime_type.startsWith("audio/") ||
            (attachment.message_id !== null && attachment.message_id !== body.messageId),
        )
      ) {
        throw new Error("The generated voice note is expired, unavailable, or already in another message.");
      }

      const { data: attached, error: attachError } = await client
        .from("chat_message_attachments")
        .update({ message_id: body.messageId, show_text: body.showText })
        .eq("user_id", user.id)
        .in("id", attachmentIds)
        .is("deleted_at", null)
        .gt("expires_at", new Date().toISOString())
        .or(`message_id.is.null,message_id.eq.${body.messageId}`)
        .select("id, message_id");
      if (attachError) {
        throw new Error(`Could not attach the generated voice note: ${attachError.message}`);
      }
      if (
        attached.length !== attachmentIds.length ||
        attached.some((attachment) => attachment.message_id !== body.messageId)
      ) {
        throw new Error("The generated voice note could not be attached to the assistant message.");
      }
      return { linked: true };
    }

    await linkChatAttachments(
      client,
      user.id,
      profile.role,
      body.messageId,
      body.attachmentIds as string[],
    );
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage: error instanceof Error ? error.message : "Could not share attachments in chat.",
    });
  }
  return { linked: true };
});
