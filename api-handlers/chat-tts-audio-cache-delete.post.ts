import { createError, defineEventHandler, getHeader, readBody } from "nitro/h3";
import { createAuthenticatedServerClient, createServiceRoleClient } from "../src/lib/server-supabase";
import { GEMINI_TTS_CACHE_BUCKET } from "../src/lib/gemini-tts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 1000;
const BATCH_SIZE = 100;

type CacheCleanupRequest =
  | { scope: "all" }
  | { scope: "branch"; messageId: string };

async function loadMessageIds(
  client: ReturnType<typeof createServiceRoleClient>,
  userId: string,
  scope: CacheCleanupRequest,
): Promise<string[]> {
  if (scope.scope === "branch") {
    const { data: anchor, error: anchorError } = await client
      .from("chat_messages")
      .select("id, role, created_at")
      .eq("id", scope.messageId)
      .eq("user_id", userId)
      .maybeSingle();
    if (anchorError) {
      throw createError({
        statusCode: 500,
        statusMessage: `Could not verify the chat branch: ${anchorError.message}`,
      });
    }
    if (!anchor || anchor.role !== "user") {
      throw createError({ statusCode: 404, statusMessage: "The user message was not found." });
    }

    const messageIds: string[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await client
        .from("chat_messages")
        .select("id, created_at")
        .eq("user_id", userId)
        .gte("created_at", anchor.created_at)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        throw createError({
          statusCode: 500,
          statusMessage: `Could not list messages in this branch: ${error.message}`,
        });
      }
      for (const message of data) {
        if (
          message.created_at > anchor.created_at ||
          (message.created_at === anchor.created_at && message.id >= anchor.id)
        ) {
          messageIds.push(message.id);
        }
      }
      if (data.length < PAGE_SIZE) break;
    }
    return messageIds;
  }

  const messageIds: string[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client
      .from("chat_messages")
      .select("id")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      throw createError({
        statusCode: 500,
        statusMessage: `Could not list chat messages for audio cleanup: ${error.message}`,
      });
    }
    messageIds.push(...data.map((message) => message.id));
    if (data.length < PAGE_SIZE) break;
  }
  return messageIds;
}

async function loadCacheRows(
  client: ReturnType<typeof createServiceRoleClient>,
  userId: string,
  scope: CacheCleanupRequest,
  messageIds: string[],
): Promise<Array<{ id: string; storage_path: string | null }>> {
  const rows: Array<{ id: string; storage_path: string | null }> = [];
  if (scope.scope === "all") {
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await client
        .from("chat_tts_audio_cache")
        .select("id, storage_path")
        .eq("user_id", userId)
        .eq("source", "gemini")
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        throw createError({
          statusCode: 500,
          statusMessage: `Could not list generated speech for deletion: ${error.message}`,
        });
      }
      rows.push(...data);
      if (data.length < PAGE_SIZE) break;
    }
    return rows;
  }

  for (let offset = 0; offset < messageIds.length; offset += BATCH_SIZE) {
    const { data, error } = await client
      .from("chat_tts_audio_cache")
      .select("id, storage_path")
      .eq("user_id", userId)
      .eq("source", "gemini")
      .in("message_id", messageIds.slice(offset, offset + BATCH_SIZE));
    if (error) {
      throw createError({
        statusCode: 500,
        statusMessage: `Could not load generated speech for this branch: ${error.message}`,
      });
    }
    rows.push(...data);
  }
  return rows;
}

async function removeCacheRows(
  client: ReturnType<typeof createServiceRoleClient>,
  userId: string,
  rows: Array<{ id: string; storage_path: string | null }>,
): Promise<void> {
  const storagePaths = [...new Set(
    rows
      .map((row) => row.storage_path)
      .filter((path): path is string => Boolean(path)),
  )];
  for (let offset = 0; offset < storagePaths.length; offset += BATCH_SIZE) {
    const { error } = await client.storage
      .from(GEMINI_TTS_CACHE_BUCKET)
      .remove(storagePaths.slice(offset, offset + BATCH_SIZE));
    if (error) {
      throw createError({
        statusCode: 502,
        statusMessage: `Could not delete generated Gemini speech: ${error.message}`,
      });
    }
  }

  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const ids = rows.slice(offset, offset + BATCH_SIZE).map((row) => row.id);
    const { error } = await client
      .from("chat_tts_audio_cache")
      .delete()
      .eq("user_id", userId)
      .in("id", ids);
    if (error) {
      throw createError({
        statusCode: 500,
        statusMessage: `Could not delete generated speech metadata: ${error.message}`,
      });
    }
  }
}

export default defineEventHandler(async (event) => {
  const accessToken = getHeader(event, "authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) {
    throw createError({ statusCode: 401, statusMessage: "Sign in before deleting chat history." });
  }
  const requestClient = createAuthenticatedServerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await requestClient.auth.getUser(accessToken);
  if (authError || !user || user.is_anonymous) {
    throw createError({ statusCode: 401, statusMessage: "Your account session is invalid or expired." });
  }

  const body = await readBody<Partial<CacheCleanupRequest>>(event);
  let scope: CacheCleanupRequest;
  if (body?.scope === "all") {
    scope = { scope: "all" };
  } else if (body?.scope === "branch" && typeof body.messageId === "string" && UUID_PATTERN.test(body.messageId)) {
    scope = { scope: "branch", messageId: body.messageId };
  } else {
    throw createError({ statusCode: 400, statusMessage: "The speech cleanup request is invalid." });
  }

  const serviceClient = createServiceRoleClient();
  const messageIds = await loadMessageIds(serviceClient, user.id, scope);
  const cacheRows = await loadCacheRows(serviceClient, user.id, scope, messageIds);
  await removeCacheRows(serviceClient, user.id, cacheRows);

  const { data: deletedMessageCount, error: deleteError } =
    scope.scope === "all"
      ? await requestClient.rpc("clear_chat_history")
      : await requestClient.rpc("delete_chat_branch_from_message", {
          p_message_id: scope.messageId,
        });
  if (deleteError) {
    throw createError({
      statusCode: 500,
      statusMessage: `Generated audio was removed, but the chat messages could not be deleted: ${deleteError.message}`,
    });
  }
  if (scope.scope === "branch" && deletedMessageCount < 1) {
    throw createError({
      statusCode: 404,
      statusMessage: "Generated audio was removed, but the message branch was not deleted.",
    });
  }

  try {
    await removeCacheRows(
      serviceClient,
      user.id,
      await loadCacheRows(serviceClient, user.id, scope, messageIds),
    );
  } catch (error) {
    throw createError({
      statusCode: 502,
      statusMessage: `Chat messages were deleted, but final generated-audio cleanup failed: ${
        error instanceof Error ? error.message : "Unknown storage error."
      }`,
    });
  }

  return {
    deletedAudioCount: cacheRows.length,
    deletedMessageCount,
    messageIds,
  };
});
