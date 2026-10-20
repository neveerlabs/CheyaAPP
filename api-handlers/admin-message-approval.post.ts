import { createError, defineEventHandler, getHeader, readBody } from "nitro/h3";
import { createAuthenticatedServerClient, createServiceRoleClient } from "../src/lib/server-supabase";
import { sendPushToAccounts } from "../src/lib/server-push";

const uuidPattern = /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

export default defineEventHandler(async (event) => {
  const accessToken = getHeader(event, "authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) {
    throw createError({ statusCode: 401, statusMessage: "Sign in before approving a message." });
  }
  const authClient = createAuthenticatedServerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser(accessToken);
  if (authError || !user || user.is_anonymous) {
    throw createError({ statusCode: 401, statusMessage: "Your account session is invalid or expired." });
  }

  const body = await readBody<{ requestId?: unknown; approve?: unknown }>(event);
  if (
    !body ||
    typeof body.requestId !== "string" ||
    !uuidPattern.test(body.requestId) ||
    typeof body.approve !== "boolean"
  ) {
    throw createError({ statusCode: 400, statusMessage: "The message approval request is invalid." });
  }

  const serviceClient = createServiceRoleClient();
  const { data: profile, error: profileError } = await serviceClient
    .from("account_profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profileError) throw new Error(`Could not verify administrator role: ${profileError.message}`);
  if (profile?.role !== "admin") {
    throw createError({ statusCode: 403, statusMessage: "Only administrators can approve messages." });
  }

  const { data: request, error: requestError } = await serviceClient
    .from("admin_message_requests")
    .select("id, admin_user_id, recipient_user_ids, all_accounts, title, body, status")
    .eq("id", body.requestId)
    .eq("admin_user_id", user.id)
    .maybeSingle();
  if (requestError) throw new Error(`Could not load the pending message: ${requestError.message}`);
  if (!request || request.status !== "pending") {
    throw createError({ statusCode: 409, statusMessage: "This message is no longer pending approval." });
  }

  let recipientIds = request.recipient_user_ids;
  if (request.all_accounts) {
    const { data: accounts, error: accountsError } = await serviceClient
      .from("account_profiles")
      .select("user_id")
      .neq("user_id", user.id);
    if (accountsError) throw new Error(`Could not load message recipients: ${accountsError.message}`);
    recipientIds = accounts.map((account) => account.user_id);
  }

  const { data: deliveredCount, error: finalizeError } = await authClient.rpc(
    "finalize_admin_message_request",
    {
      p_request_id: request.id,
      p_approve: body.approve,
    },
  );
  if (finalizeError) {
    throw createError({
      statusCode: 400,
      statusMessage: `Could not ${body.approve ? "deliver" : "cancel"} this message: ${finalizeError.message}`,
    });
  }
  if (!body.approve) return { deliveredCount: 0, push: null };

  let push: Awaited<ReturnType<typeof sendPushToAccounts>> | null = null;
  let pushError: string | null = null;
  try {
    push = await sendPushToAccounts(recipientIds, request.title, request.body);
  } catch (error) {
    pushError = error instanceof Error ? error.message : "Unknown push service error.";
    console.error("The admin message was delivered to inboxes, but push delivery failed.", error);
  }
  return {
    deliveredCount: typeof deliveredCount === "number" ? deliveredCount : 0,
    push,
    pushError,
  };
});
