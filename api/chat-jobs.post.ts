import { createError, defineEventHandler, getHeader, readBody } from "nitro/h3";
import { start } from "workflow/api";
import { createChatResponseWorkflow } from "../workflows/chat-response";
import { createAuthenticatedServerClient, createServiceRoleClient } from "../src/lib/server-supabase";

type ChatJobRequest = {
  content?: unknown;
  thinkingMode?: unknown;
  attachmentIds?: unknown;
};

export default defineEventHandler(async (event) => {
  const authorization = getHeader(event, "authorization");
  const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) {
    throw createError({ statusCode: 401, statusMessage: "Sign in before sending a message." });
  }

  const requestClient = createAuthenticatedServerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await requestClient.auth.getUser(accessToken);
  if (authError || !user || user.is_anonymous) {
    throw createError({ statusCode: 401, statusMessage: "Your account session is invalid or expired." });
  }

  const body = await readBody<ChatJobRequest>(event);
  if (!body || typeof body !== "object") {
    throw createError({ statusCode: 400, statusMessage: "A chat request body is required." });
  }
  if (body?.content !== undefined && typeof body.content !== "string") {
    throw createError({ statusCode: 400, statusMessage: "Message content must be text." });
  }
  if (typeof body?.content === "string" && body.content.length > 50000) {
    throw createError({ statusCode: 400, statusMessage: "Message must contain 1–50,000 characters." });
  }
  if (body.thinkingMode !== undefined && typeof body.thinkingMode !== "boolean") {
    throw createError({ statusCode: 400, statusMessage: "Thinking mode must be a boolean." });
  }
  if (
    body.attachmentIds !== undefined &&
    (!Array.isArray(body.attachmentIds) ||
      body.attachmentIds.length > 10 ||
      body.attachmentIds.some((id) => typeof id !== "string"))
  ) {
    throw createError({ statusCode: 400, statusMessage: "Attachment IDs are invalid." });
  }
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  const attachmentIds = (body.attachmentIds ?? []) as string[];
  if (!content && attachmentIds.length === 0) {
    throw createError({ statusCode: 400, statusMessage: "Write a message or attach a file." });
  }

  const { data: keys, error: keysError } = await requestClient
    .from("ai_api_keys")
    .select("id")
    .limit(1);
  if (keysError) {
    throw createError({ statusCode: 500, statusMessage: `Could not check Gemini configuration: ${keysError.message}` });
  }
  if (keys.length === 0) {
    throw createError({ statusCode: 400, statusMessage: "Add a Gemini API key in Settings first." });
  }

  const { data: jobs, error: jobError } = await requestClient.rpc("create_chat_job_with_attachments", {
    p_content: content || "Please review the attached files.",
    p_thinking_mode: body.thinkingMode === true,
    p_attachment_ids: attachmentIds,
  });
  if (jobError) {
    throw createError({ statusCode: 500, statusMessage: `Could not save your message: ${jobError.message}` });
  }
  const job = jobs[0];
  if (!job) throw createError({ statusCode: 500, statusMessage: "The database did not return a chat job." });

  try {
    const run = await start(createChatResponseWorkflow, [job.job_id]);
    return { jobId: job.job_id, messageId: job.message_id, runId: run.runId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start the durable chat workflow.";
    const serviceClient = createServiceRoleClient();
    const { error: updateError } = await serviceClient
      .from("chat_message_jobs")
      .update({
        status: "failed",
        error: message,
        progress: "The response could not be queued.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.job_id)
      .eq("user_id", user.id);
    if (updateError) {
      throw createError({
        statusCode: 500,
        statusMessage: `Could not start chat processing (${message}); saving its failure status also failed: ${updateError.message}`,
      });
    }
    throw createError({ statusCode: 503, statusMessage: message });
  }
});
