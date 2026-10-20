import { createError, defineEventHandler, getHeader } from "nitro/h3";
import { createAuthenticatedServerClient, createServiceRoleClient } from "../src/lib/server-supabase";

export default defineEventHandler(async (event) => {
  const accessToken = getHeader(event, "authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) {
    throw createError({ statusCode: 401, statusMessage: "Sign in before clearing your inbox." });
  }

  const authClient = createAuthenticatedServerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser(accessToken);
  if (authError || !user || user.is_anonymous) {
    throw createError({ statusCode: 401, statusMessage: "Your account session is invalid or expired." });
  }

  const serviceClient = createServiceRoleClient();
  const { data, error } = await serviceClient
    .from("account_inbox")
    .delete()
    .eq("recipient_user_id", user.id)
    .select("id");
  if (error) throw new Error(`Could not clear the account notification inbox: ${error.message}`);
  return { deletedCount: data.length };
});
