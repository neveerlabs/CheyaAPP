import { createError, defineEventHandler, getHeader, readBody } from "nitro/h3";
import { createAuthenticatedServerClient } from "../src/lib/server-supabase";
import { getPageMetadata } from "../src/lib/server-page";

export default defineEventHandler(async (event) => {
  const authorization = getHeader(event, "authorization");
  const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) {
    throw createError({ statusCode: 401, statusMessage: "Sign in to load link previews." });
  }

  const client = createAuthenticatedServerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser(accessToken);
  if (authError || !user || user.is_anonymous) {
    throw createError({ statusCode: 401, statusMessage: "Your account session is invalid or expired." });
  }

  const body: unknown = await readBody(event);
  const url = typeof body === "object" && body !== null && "url" in body ? body.url : null;
  if (typeof url !== "string" || url.length > 2048) {
    throw createError({ statusCode: 400, statusMessage: "Provide a valid URL up to 2,048 characters." });
  }

  try {
    return await getPageMetadata(url);
  } catch (error) {
    throw createError({
      statusCode: 422,
      statusMessage: error instanceof Error ? error.message : "Could not load this page preview.",
    });
  }
});
