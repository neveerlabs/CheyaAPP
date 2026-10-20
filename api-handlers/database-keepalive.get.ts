import { createError, defineEventHandler, getHeader } from "nitro/h3";
import { createServiceRoleClient, getServerEnvironmentVariable } from "../src/lib/server-supabase";

export default defineEventHandler(async (event) => {
  const secret = getServerEnvironmentVariable("CRON_SECRET");
  if (!secret) {
    throw createError({
      statusCode: 500,
      statusMessage: "CRON_SECRET is not configured for the database keepalive task.",
    });
  }

  const authorization = getHeader(event, "authorization") ?? "";
  if (authorization !== `Bearer ${secret}`) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized database keepalive request." });
  }

  const client = createServiceRoleClient();
  const { data, error } = await client.rpc("run_database_keepalive");
  if (error) {
    throw createError({
      statusCode: 500,
      statusMessage: `Database keepalive failed: ${error.message}`,
    });
  }
  const result = data[0];
  if (!result) {
    throw createError({
      statusCode: 500,
      statusMessage: "Database keepalive returned no status.",
    });
  }

  return result;
});
