import { createError, defineEventHandler, getHeader, readBody } from "nitro/h3";
import { sendAiFailureToInbox } from "../src/lib/server-push";
import { createAuthenticatedServerClient } from "../src/lib/server-supabase";

export default defineEventHandler(async (event) => {
  const authorization = getHeader(event, "authorization");
  const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) {
    throw createError({ statusCode: 401, statusMessage: "Sign in before reporting an AI error." });
  }

  const client = createAuthenticatedServerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser(accessToken);
  if (authError || !user || user.is_anonymous) {
    throw createError({ statusCode: 401, statusMessage: "Your account session is invalid or expired." });
  }

  const body = await readBody<{ message?: unknown }>(event);
  if (typeof body?.message !== "string" || !body.message.trim() || body.message.length > 10000) {
    throw createError({ statusCode: 400, statusMessage: "The AI error message is invalid." });
  }

  await sendAiFailureToInbox(user.id, crypto.randomUUID(), body.message.trim());
  return { saved: true };
});
