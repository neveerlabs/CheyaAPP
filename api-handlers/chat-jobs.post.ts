import { createError, defineEventHandler, getHeader, readBody } from "nitro/h3";
import { start } from "workflow/api";
import { createChatResponseWorkflow } from "../workflows/chat-response";
import { sendAiFailureToInbox } from "../src/lib/server-push";
import { createAuthenticatedServerClient, createServiceRoleClient } from "../src/lib/server-supabase";
import type { AiBarcodeReading } from "../src/lib/chat-barcode";

type ChatJobRequest = {
  content?: unknown;
  thinkingMode?: unknown;
  attachmentIds?: unknown;
  barcodeReadings?: unknown;
  clientRequestId?: unknown;
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
    typeof body.clientRequestId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      body.clientRequestId,
    )
  ) {
    throw createError({ statusCode: 400, statusMessage: "A valid client request ID is required." });
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
  const barcodeReadings = body.barcodeReadings ?? [];
  if (!content && attachmentIds.length === 0) {
    throw createError({ statusCode: 400, statusMessage: "Write a message or attach a file." });
  }
  if (
    !Array.isArray(barcodeReadings) ||
    barcodeReadings.length > 10 ||
    barcodeReadings.some(
      (reading) =>
        typeof reading !== "object" ||
        reading === null ||
        !("attachmentId" in reading) ||
        typeof reading.attachmentId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reading.attachmentId) ||
        !attachmentIds.includes(reading.attachmentId) ||
        !("format" in reading) ||
        typeof reading.format !== "string" ||
        reading.format.length < 1 ||
        reading.format.length > 64 ||
        !("text" in reading) ||
        typeof reading.text !== "string" ||
        reading.text.length < 1 ||
        reading.text.length > 4096
    )
  ) {
    throw createError({ statusCode: 400, statusMessage: "Scanned barcode context is invalid." });
  }
  const typedBarcodeReadings = barcodeReadings as AiBarcodeReading[];
  const barcodeAttachmentIds = [...new Set(typedBarcodeReadings.map((item) => item.attachmentId))];
  if (barcodeAttachmentIds.length !== typedBarcodeReadings.length) {
    throw createError({ statusCode: 400, statusMessage: "Barcode context contains duplicate attachments." });
  }
  if (barcodeAttachmentIds.length > 0) {
    const { data: barcodeAttachments, error: barcodeAttachmentError } = await requestClient
      .from("chat_message_attachments")
      .select("id, mime_type")
      .in("id", barcodeAttachmentIds)
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .gt("expires_at", new Date().toISOString());
    if (barcodeAttachmentError) {
      throw createError({
        statusCode: 500,
        statusMessage: `Could not verify scanned barcode attachments: ${barcodeAttachmentError.message}`,
      });
    }
    if (
      barcodeAttachments.length !== barcodeAttachmentIds.length ||
      barcodeAttachments.some((attachment) => !attachment.mime_type.startsWith("image/"))
    ) {
      throw createError({
        statusCode: 400,
        statusMessage: "Barcode context must refer to your active image attachments.",
      });
    }
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
    p_client_request_id: body.clientRequestId,
  });
  if (jobError) {
    throw createError({ statusCode: 500, statusMessage: `Could not save your message: ${jobError.message}` });
  }
  const job = jobs[0];
  if (!job) throw createError({ statusCode: 500, statusMessage: "The database did not return a chat job." });

  if (!job.created) {
    const { data: existingJob, error: existingJobError } = await requestClient
      .from("chat_message_jobs")
      .select("status")
      .eq("id", job.job_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (existingJobError || !existingJob) {
      throw createError({
        statusCode: 500,
        statusMessage: `Could not check the existing chat request: ${
          existingJobError?.message ?? "The job was not found."
        }`,
      });
    }
    if (existingJob.status !== "failed") {
      return { jobId: job.job_id, messageId: job.message_id, runId: null };
    }
    const { data: retryClaim, error: retryError } = await createServiceRoleClient()
      .from("chat_message_jobs")
      .update({
        status: "queued",
        error: null,
        progress: "Retrying your chat request…",
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.job_id)
      .eq("user_id", user.id)
      .eq("status", "failed")
      .select("id")
      .maybeSingle();
    if (retryError) {
      throw createError({
        statusCode: 500,
        statusMessage: `Could not retry your chat request: ${retryError.message}`,
      });
    }
    if (!retryClaim) {
      return { jobId: job.job_id, messageId: job.message_id, runId: null };
    }
  }

  try {
    const run = await start(createChatResponseWorkflow, [job.job_id, typedBarcodeReadings]);
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
    await sendAiFailureToInbox(user.id, job.job_id, message);
    return { jobId: job.job_id, messageId: job.message_id, runId: null };
  }
});
