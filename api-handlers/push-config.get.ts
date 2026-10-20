import { createError, defineEventHandler } from "nitro/h3";
import { getServerEnvironmentVariable } from "../src/lib/server-supabase";

export default defineEventHandler(() => {
  const publicKey = getServerEnvironmentVariable("VAPID_PUBLIC_KEY");
  const privateKey = getServerEnvironmentVariable("VAPID_PRIVATE_KEY");
  const subject = getServerEnvironmentVariable("VAPID_SUBJECT");
  if (!publicKey || !privateKey || !subject) {
    throw createError({
      statusCode: 503,
      statusMessage:
        "Push notifications are not configured on the server. Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT.",
    });
  }
  return { publicKey };
});
