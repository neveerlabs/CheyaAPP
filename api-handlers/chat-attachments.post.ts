import { createError, defineEventHandler, getHeader, readBody } from "nitro/h3";
import { start } from "workflow/api";
import {
  CHAT_ATTACHMENT_BUCKET,
  MAX_CHAT_ATTACHMENT_BYTES,
  resolveChatAttachmentMimeType,
  type ChatAttachment,
} from "../src/lib/chat-attachments";
import { createAuthenticatedServerClient, createServiceRoleClient } from "../src/lib/server-supabase";
import { expireChatAttachmentWorkflow } from "../workflows/expire-chat-attachment";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha256Pattern = /^[0-9a-f]{64}$/;

type RegisterAttachmentRequest = {
  action?: unknown;
  id?: unknown;
  fileName?: unknown;
  mimeType?: unknown;
  sizeBytes?: unknown;
  sha256?: unknown;
};

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

async function sha256FromBytes(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function removeObject(
  serviceClient: ReturnType<typeof createServiceRoleClient>,
  storagePath: string,
): Promise<void> {
  const { error } = await serviceClient.storage.from(CHAT_ATTACHMENT_BUCKET).remove([storagePath]);
  if (error) throw new Error(`Could not remove attachment object: ${error.message}`);
}

async function cleanupReference(
  serviceClient: ReturnType<typeof createServiceRoleClient>,
  attachmentId: string,
  userId: string,
): Promise<void> {
  const { data, error } = await serviceClient.rpc("release_chat_attachment_reference", {
    p_attachment_id: attachmentId,
    p_user_id: userId,
    p_expired_only: false,
  });
  if (error) throw new Error(`Could not release attachment reference: ${error.message}`);
  const released = data[0];
  if (!released?.should_delete || !released.storage_path) return;

  await removeObject(serviceClient, released.storage_path);
  const { data: purged, error: purgeError } = await serviceClient.rpc(
    "purge_released_chat_attachment_references",
    { p_user_id: userId, p_storage_path: released.storage_path },
  );
  if (purgeError) throw new Error(`Could not remove released attachment metadata: ${purgeError.message}`);
  if (!purged) throw new Error("Attachment references changed while cleaning up the stored file.");
}

export default defineEventHandler(async (event) => {
  const accessToken = getHeader(event, "authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) {
    throw createError({ statusCode: 401, statusMessage: "Sign in before uploading an attachment." });
  }

  const requestClient = createAuthenticatedServerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await requestClient.auth.getUser(accessToken);
  if (authError || !user || user.is_anonymous) {
    throw createError({ statusCode: 401, statusMessage: "Your account session is invalid or expired." });
  }

  const body = await readBody<RegisterAttachmentRequest>(event);
  if (
    (body?.action !== "prepare" && body?.action !== "register") ||
    typeof body.id !== "string" ||
    !uuidPattern.test(body.id) ||
    typeof body.fileName !== "string" ||
    body.fileName.trim().length < 1 ||
    body.fileName.length > 255 ||
    /[\u0000-\u001f\u007f]/.test(body.fileName) ||
    typeof body.mimeType !== "string" ||
    typeof body.sizeBytes !== "number" ||
    !Number.isInteger(body.sizeBytes) ||
    body.sizeBytes < 1 ||
    body.sizeBytes > MAX_CHAT_ATTACHMENT_BYTES ||
    typeof body.sha256 !== "string" ||
    !sha256Pattern.test(body.sha256)
  ) {
    throw createError({ statusCode: 400, statusMessage: "Attachment metadata is invalid." });
  }

  const mimeType = resolveChatAttachmentMimeType({
    name: body.fileName,
    type: body.mimeType,
  });
  if (!mimeType || mimeType !== body.mimeType) {
    throw createError({ statusCode: 400, statusMessage: "This file type is not supported." });
  }

  const serviceClient = createServiceRoleClient();
  const storagePath = `${user.id}/${body.id}`;
  let uploadedTempObject = false;

  const { data: existingId, error: existingIdError } = await serviceClient
    .from("chat_message_attachments")
    .select("id")
    .eq("id", body.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (existingIdError) {
    throw createError({
      statusCode: 500,
      statusMessage: `Could not validate attachment identity: ${existingIdError.message}`,
    });
  }
  if (existingId) {
    throw createError({ statusCode: 409, statusMessage: "This attachment draft was already registered." });
  }

  if (body.action === "prepare") {
    const legacyPaths: string[] = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data: legacyAttachments, error: legacyLookupError } = await serviceClient
        .from("chat_message_attachments")
        .select("storage_path")
        .eq("user_id", user.id)
        .eq("size_bytes", body.sizeBytes)
        .is("sha256", null)
        .is("deleted_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .range(offset, offset + pageSize - 1);
      if (legacyLookupError) {
        throw createError({
          statusCode: 500,
          statusMessage: `Could not check retained attachments for duplicates: ${legacyLookupError.message}`,
        });
      }
      legacyPaths.push(...legacyAttachments.map((item) => item.storage_path));
      if (legacyAttachments.length < pageSize) break;
    }

    for (const legacyPath of new Set(legacyPaths)) {
      const { data: legacyFile, error: downloadError } = await serviceClient.storage
        .from(CHAT_ATTACHMENT_BUCKET)
        .download(legacyPath);
      if (downloadError) {
        throw createError({
          statusCode: 502,
          statusMessage: `Could not verify a retained attachment: ${downloadError.message}`,
        });
      }
      const legacyHash = await sha256FromBytes(await legacyFile.arrayBuffer());
      const { error: backfillError } = await serviceClient
        .from("chat_message_attachments")
        .update({ sha256: legacyHash })
        .eq("user_id", user.id)
        .eq("storage_path", legacyPath)
        .is("sha256", null);
      if (backfillError) {
        throw createError({
          statusCode: 500,
          statusMessage: `Could not index a retained attachment: ${backfillError.message}`,
        });
      }
    }
  }

  if (body.action === "register") {
    const { data: objects, error: listError } = await serviceClient.storage
      .from(CHAT_ATTACHMENT_BUCKET)
      .list(user.id, { limit: 100, search: body.id });
    if (listError) {
      throw createError({
        statusCode: 502,
        statusMessage: `Could not verify uploaded file: ${listError.message}`,
      });
    }
    const uploadedObject = objects.find((item) => item.name === body.id);
    const objectMetadata =
      uploadedObject?.metadata && typeof uploadedObject.metadata === "object"
        ? (uploadedObject.metadata as Record<string, unknown>)
        : null;
    if (
      !uploadedObject ||
      Number(objectMetadata?.size) !== body.sizeBytes ||
      (typeof objectMetadata?.mimetype === "string" && objectMetadata.mimetype !== mimeType)
    ) {
      throw createError({
        statusCode: 400,
        statusMessage: "The uploaded file did not match its declared size or file type.",
      });
    }

    const { data: file, error: downloadError } = await serviceClient.storage
      .from(CHAT_ATTACHMENT_BUCKET)
      .download(storagePath);
    if (downloadError) {
      throw createError({
        statusCode: 502,
        statusMessage: `Could not verify uploaded file contents: ${downloadError.message}`,
      });
    }
    const actualHash = await sha256FromBytes(await file.arrayBuffer());
    if (actualHash !== body.sha256) {
      throw createError({ statusCode: 400, statusMessage: "Uploaded file content failed verification." });
    }
    uploadedTempObject = true;
  }

  const { data: registered, error: registrationError } = await serviceClient.rpc(
    "register_chat_attachment_reference",
    {
      p_id: body.id,
      p_user_id: user.id,
      p_sha256: body.sha256,
      p_storage_path: body.action === "register" ? storagePath : null,
      p_file_name: body.fileName.trim(),
      p_mime_type: mimeType,
      p_size_bytes: body.sizeBytes,
    },
  );
  if (registrationError) {
    if (uploadedTempObject) await removeObject(serviceClient, storagePath);
    throw createError({
      statusCode: 500,
      statusMessage: `Could not save attachment metadata: ${registrationError.message}`,
    });
  }

  const attachment = registered[0];
  if (!attachment) {
    const { data: orphanedObjects, error: orphanListError } = await serviceClient.storage
      .from(CHAT_ATTACHMENT_BUCKET)
      .list(user.id, { limit: 100, search: body.id });
    if (orphanListError) {
      throw createError({
        statusCode: 502,
        statusMessage: `Could not check for an unfinished upload: ${orphanListError.message}`,
      });
    }
    if (orphanedObjects.some((object) => object.name === body.id)) {
      await removeObject(serviceClient, storagePath);
    }
    return { uploadRequired: true, reused: false };
  }

  try {
    await start(expireChatAttachmentWorkflow, [attachment.id]);
    if (uploadedTempObject && attachment.storage_path !== storagePath) {
      await removeObject(serviceClient, storagePath);
    }
  } catch (error) {
    let cleanupError: string | null = null;
    try {
      await cleanupReference(serviceClient, attachment.id, user.id);
    } catch (cleanupFailure) {
      cleanupError = getErrorMessage(cleanupFailure, "Attachment cleanup failed.");
    }
    if (uploadedTempObject && attachment.storage_path !== storagePath) {
      try {
        await removeObject(serviceClient, storagePath);
      } catch (cleanupFailure) {
        cleanupError = [cleanupError, getErrorMessage(cleanupFailure, "Temporary upload cleanup failed.")]
          .filter(Boolean)
          .join(" ");
      }
    }
    const message = getErrorMessage(error, "Could not schedule attachment expiration.");
    throw createError({
      statusCode: cleanupError ? 500 : 503,
      statusMessage: cleanupError ? `${message} Cleanup also failed: ${cleanupError}` : message,
    });
  }

  const response: ChatAttachment = {
    id: attachment.id,
    user_id: attachment.user_id,
    message_id: attachment.message_id,
    file_name: attachment.file_name,
    mime_type: attachment.mime_type,
    size_bytes: attachment.size_bytes,
    created_at: attachment.created_at,
    expires_at: attachment.expires_at,
    deleted_at: attachment.deleted_at,
  };
  return { uploadRequired: false, reused: attachment.reused, attachment: response };
});
