import { createError, defineEventHandler, getHeader, readBody } from "nitro/h3";
import {
  AccountAiToolError,
  executeAccountAiTool,
} from "../src/lib/server-ai-tools";
import { createAuthenticatedServerClient } from "../src/lib/server-supabase";

const supportedActions = new Set([
  "search_product_help",
  "ask_admin_product_question",
  "check_product_help_status",
  "search_pending_product_questions",
  "prepare_product_help_answer",
  "confirm_product_help_answer",
  "start_admin_public_memory_request",
  "search_admin_public_memory_requests",
  "prepare_admin_public_memory",
  "confirm_admin_public_memory",
  "send_message_to_admin",
  "search_all_account_data",
  "share_chat_attachment",
  "prepare_admin_message",
  "forward_user_attachment_to_admin",
  "create_reminder",
  "search_reminders",
  "cancel_reminder",
  "send_push_notification",
]);

export default defineEventHandler(async (event) => {
  const authorization = getHeader(event, "authorization");
  const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) {
    throw createError({ statusCode: 401, statusMessage: "Sign in before using account AI actions." });
  }

  const client = createAuthenticatedServerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser(accessToken);
  if (authError || !user || user.is_anonymous) {
    throw createError({ statusCode: 401, statusMessage: "Your account session is invalid or expired." });
  }

  const body = await readBody<{ name?: unknown; input?: unknown; sourceMessageId?: unknown }>(event);
  if (
    !body ||
    typeof body.name !== "string" ||
    !supportedActions.has(body.name) ||
    typeof body.input !== "object" ||
    body.input === null ||
    Array.isArray(body.input)
  ) {
    throw createError({ statusCode: 400, statusMessage: "The requested account AI action is invalid." });
  }
  if (
    body.sourceMessageId !== undefined &&
    (typeof body.sourceMessageId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.sourceMessageId))
  ) {
    throw createError({ statusCode: 400, statusMessage: "The source chat message ID is invalid." });
  }

  try {
    return {
      result: await executeAccountAiTool(
        user.id,
        body.name,
        body.input,
        typeof body.sourceMessageId === "string" ? body.sourceMessageId : undefined,
      ),
    };
  } catch (error) {
    if (error instanceof AccountAiToolError) {
      throw createError({
        statusCode: error.statusCode,
        statusMessage: error.message,
      });
    }
    throw error;
  }
});
