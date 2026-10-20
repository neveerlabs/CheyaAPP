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

  const body = await readBody<{ messageId?: unknown; attachmentIds?: unknown }>(event);
  if (
    typeof body?.messageId !== "string" ||
    !uuidPattern.test(body.messageId) ||
    !Array.isArray(body.attachmentIds) ||
    body.attachmentIds.length > 10 ||
    body.attachmentIds.some((id) => typeof id !== "string" || !uuidPattern.test(id))
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
