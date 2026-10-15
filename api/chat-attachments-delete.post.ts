import { createError, defineEventHandler, getHeader, readBody } from "nitro/h3";
import { releaseStoredChatAttachment } from "../src/lib/chat-data";
import { createAuthenticatedServerClient, createServiceRoleClient } from "../src/lib/server-supabase";
import { CHAT_ATTACHMENT_BUCKET } from "../src/lib/chat-attachments";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default defineEventHandler(async (event) => {
  const accessToken = getHeader(event, "authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) {
    throw createError({ statusCode: 401, statusMessage: "Sign in before deleting an attachment." });
  }

  const requestClient = createAuthenticatedServerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await requestClient.auth.getUser(accessToken);
  if (authError || !user || user.is_anonymous) {
    throw createError({ statusCode: 401, statusMessage: "Your account session is invalid or expired." });
  }

  const body = await readBody<{ ids?: unknown }>(event);
  if (
    !Array.isArray(body?.ids) ||
    body.ids.length < 1 ||
    body.ids.length > 1000 ||
    body.ids.some((id) => typeof id !== "string" || !uuidPattern.test(id)) ||
    new Set(body.ids).size !== body.ids.length
  ) {
    throw createError({ statusCode: 400, statusMessage: "Attachment IDs are invalid." });
  }

  const serviceClient = createServiceRoleClient();
  const { data: attachments, error: loadError } = await serviceClient
    .from("chat_message_attachments")
    .select("id")
    .eq("user_id", user.id)
    .in("id", body.ids);
  if (loadError) {
    throw createError({
      statusCode: 500,
      statusMessage: `Could not load attachments for deletion: ${loadError.message}`,
    });
  }
  for (const attachment of attachments) {
    try {
      await releaseStoredChatAttachment(serviceClient, attachment.id, user.id);
    } catch (error) {
      throw createError({
        statusCode: 502,
        statusMessage:
          error instanceof Error
            ? `Could not delete attachment ${attachment.id}: ${error.message}`
            : `Could not delete attachment ${attachment.id}.`,
      });
    }
  }

  const foundIds = new Set(attachments.map(({ id }) => id));
  for (const id of body.ids as string[]) {
    if (foundIds.has(id)) continue;
    const storagePath = `${user.id}/${id}`;
    const { data: references, error: referenceError } = await serviceClient
      .from("chat_message_attachments")
      .select("id")
      .eq("user_id", user.id)
      .eq("storage_path", storagePath)
      .limit(1);
    if (referenceError) {
      throw createError({
        statusCode: 500,
        statusMessage: `Could not verify an unregistered upload: ${referenceError.message}`,
      });
    }
    if (references.length > 0) {
      throw createError({
        statusCode: 409,
        statusMessage: "An upload without its attachment record is still referenced by another message.",
      });
    }
    const { data: objects, error: listError } = await serviceClient.storage
      .from(CHAT_ATTACHMENT_BUCKET)
      .list(user.id, { limit: 100, search: id });
    if (listError) {
      throw createError({
        statusCode: 502,
        statusMessage: `Could not check for an unfinished upload: ${listError.message}`,
      });
    }
    if (objects.some((object) => object.name === id)) {
      const { error: removeError } = await serviceClient.storage
        .from(CHAT_ATTACHMENT_BUCKET)
        .remove([storagePath]);
      if (removeError) {
        throw createError({
          statusCode: 502,
          statusMessage: `Could not remove the unfinished upload: ${removeError.message}`,
        });
      }
    }
  }

  return { deleted: body.ids.length };
});
