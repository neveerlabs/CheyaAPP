import { createError, defineEventHandler, getHeader } from "nitro/h3";
import { createAuthenticatedServerClient, createServiceRoleClient } from "../src/lib/server-supabase";
import { CHAT_ATTACHMENT_BUCKET } from "../src/lib/chat-attachments";
import { GEMINI_TTS_CACHE_BUCKET } from "../src/lib/gemini-tts";

async function removeStoragePaths(
  client: ReturnType<typeof createServiceRoleClient>,
  bucket: string,
  paths: string[],
): Promise<void> {
  for (let offset = 0; offset < paths.length; offset += 100) {
    const { error } = await client.storage.from(bucket).remove(paths.slice(offset, offset + 100));
    if (error) {
      throw createError({
        statusCode: 502,
        statusMessage: `Could not delete account files from ${bucket}: ${error.message}`,
      });
    }
  }
}

async function listStoragePaths(
  client: ReturnType<typeof createServiceRoleClient>,
  bucket: string,
  root: string,
): Promise<string[]> {
  const paths: string[] = [];
  const folders = [root];
  while (folders.length > 0) {
    const folder = folders.pop();
    if (!folder) continue;
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await client.storage
        .from(bucket)
        .list(folder, { limit: 1000, offset });
      if (error) {
        throw createError({
          statusCode: 502,
          statusMessage: `Could not list account files from ${bucket}: ${error.message}`,
        });
      }
      for (const item of data) {
        const path = `${folder}/${item.name}`;
        if (item.id) paths.push(path);
        else folders.push(path);
      }
      if (data.length < 1000) break;
    }
  }
  return paths;
}

async function findAttachmentPathsUsedByOtherUsers(
  client: ReturnType<typeof createServiceRoleClient>,
  userId: string,
  paths: string[],
): Promise<Set<string>> {
  const sharedPaths = new Set<string>();
  for (let offset = 0; offset < paths.length; offset += 100) {
    const pathBatch = paths.slice(offset, offset + 100);
    for (let pageOffset = 0; ; pageOffset += 1000) {
      const { data, error } = await client
        .from("chat_message_attachments")
        .select("storage_path")
        .in("storage_path", pathBatch)
        .neq("user_id", userId)
        .range(pageOffset, pageOffset + 999);
      if (error) {
        throw createError({
          statusCode: 500,
          statusMessage: `Could not check shared account attachments: ${error.message}`,
        });
      }
      data.forEach((row) => sharedPaths.add(row.storage_path));
      if (data.length < 1000) break;
    }
  }
  return sharedPaths;
}

export default defineEventHandler(async (event) => {
  const accessToken = getHeader(event, "authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) {
    throw createError({ statusCode: 401, statusMessage: "Sign in before deleting your account." });
  }
  const requestClient = createAuthenticatedServerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await requestClient.auth.getUser(accessToken);
  if (authError || !user || user.is_anonymous) {
    throw createError({ statusCode: 401, statusMessage: "Your account session is invalid or expired." });
  }

  const serviceClient = createServiceRoleClient();
  const attachmentPaths: string[] = [];
  const ttsPaths: string[] = [];
  const { data: settings, error: settingsError } = await serviceClient
    .from("user_settings")
    .select("tts_api_key, tts_api_keys")
    .eq("user_id", user.id)
    .maybeSingle();
  if (settingsError) {
    throw createError({
      statusCode: 500,
      statusMessage: `Could not prepare TTS API key retention: ${settingsError.message}`,
    });
  }
  const { data: geminiApiKeys, error: geminiApiKeysError } = await serviceClient
    .from("ai_api_keys")
    .select("model, api_key")
    .eq("user_id", user.id);
  if (geminiApiKeysError) {
    throw createError({
      statusCode: 500,
      statusMessage: `Could not prepare Gemini API key retention: ${geminiApiKeysError.message}`,
    });
  }
  const ttsApiKeys = [
    settings?.tts_api_key,
    ...(Array.isArray(settings?.tts_api_keys) ? settings.tts_api_keys : []),
  ]
    .filter((key): key is string => typeof key === "string")
    .map((key) => key.trim())
    .filter((key, index, keys) => key.length > 0 && keys.indexOf(key) === index);
  const retainedApiKeys = [
    ...geminiApiKeys.map(({ model, api_key }) => ({
      user_id: user.id,
      provider: "gemini" as const,
      model,
      api_key: api_key.trim(),
    })),
    ...ttsApiKeys.map((api_key) => ({
      user_id: user.id,
      provider: "gemini_tts" as const,
      model: "",
      api_key,
    })),
  ];
  const uniqueRetainedApiKeys = [
    ...new Map(retainedApiKeys.map((key) => [
      `${key.provider}:${key.model}:${key.api_key}`,
      key,
    ])).values(),
  ];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await serviceClient
      .from("chat_message_attachments")
      .select("storage_path")
      .eq("user_id", user.id)
      .range(offset, offset + pageSize - 1);
    if (error) {
      throw createError({
        statusCode: 500,
        statusMessage: `Could not prepare account attachment deletion: ${error.message}`,
      });
    }
    attachmentPaths.push(...data.map((item) => item.storage_path));
    if (data.length < pageSize) break;
  }
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await serviceClient
      .from("chat_tts_audio_cache")
      .select("storage_path")
      .eq("user_id", user.id)
      .not("storage_path", "is", null)
      .range(offset, offset + pageSize - 1);
    if (error) {
      throw createError({
        statusCode: 500,
        statusMessage: `Could not prepare TTS audio deletion: ${error.message}`,
      });
    }
    ttsPaths.push(
      ...data
        .map((item) => item.storage_path)
        .filter((path): path is string => typeof path === "string"),
    );
    if (data.length < pageSize) break;
  }

  attachmentPaths.push(
    ...(await listStoragePaths(serviceClient, CHAT_ATTACHMENT_BUCKET, user.id)),
  );
  ttsPaths.push(
    ...(await listStoragePaths(serviceClient, GEMINI_TTS_CACHE_BUCKET, user.id)),
  );
  const uniqueAttachmentPaths = [...new Set(attachmentPaths)];
  const uniqueTtsPaths = [...new Set(ttsPaths)];
  const sharedAttachmentPaths = await findAttachmentPathsUsedByOtherUsers(
    serviceClient,
    user.id,
    uniqueAttachmentPaths,
  );
  await removeStoragePaths(
    serviceClient,
    CHAT_ATTACHMENT_BUCKET,
    uniqueAttachmentPaths.filter((path) => !sharedAttachmentPaths.has(path)),
  );
  await removeStoragePaths(serviceClient, GEMINI_TTS_CACHE_BUCKET, uniqueTtsPaths);
  const { error: ttsMetadataError } = await serviceClient
    .from("chat_tts_audio_cache")
    .delete()
    .eq("user_id", user.id);
  if (ttsMetadataError) {
    throw createError({
      statusCode: 500,
      statusMessage: `Account files were removed, but TTS cache metadata could not be deleted: ${ttsMetadataError.message}`,
    });
  }

  if (uniqueRetainedApiKeys.length > 0) {
    const { error: retainKeysError } = await serviceClient
      .from("retained_api_keys")
      .upsert(uniqueRetainedApiKeys, {
        onConflict: "user_id,provider,model,api_key",
        ignoreDuplicates: true,
      });
    if (retainKeysError) {
      throw createError({
        statusCode: 500,
        statusMessage: `Account files were removed, but API keys could not be retained. The account was not deleted: ${retainKeysError.message}`,
      });
    }
  }

  const { error: sentInboxError } = await serviceClient
    .from("account_inbox")
    .delete()
    .eq("sender_user_id", user.id);
  if (sentInboxError) {
    throw createError({
      statusCode: 500,
      statusMessage: `Account files were removed, but messages sent from this account could not be deleted: ${sentInboxError.message}`,
    });
  }

  const { error: deleteError } = await serviceClient.auth.admin.deleteUser(user.id);
  if (deleteError) {
    throw createError({
      statusCode: 500,
      statusMessage: `Account files were deleted, but the account itself could not be deleted: ${deleteError.message}`,
    });
  }
  return { deleted: true };
});
