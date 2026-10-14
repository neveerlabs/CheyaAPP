import { createError, defineEventHandler, getHeader, readBody } from "nitro/h3";
import { searchWebWithFallback } from "../src/lib/server-web-search";
import { createAuthenticatedServerClient } from "../src/lib/server-supabase";
import type { GeminiApiKey } from "../src/lib/supabase";

export default defineEventHandler(async (event) => {
  const authorization = getHeader(event, "authorization");
  const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) {
    throw createError({ statusCode: 401, statusMessage: "Sign in before searching the web." });
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
  const query = typeof body === "object" && body !== null && "query" in body ? body.query : null;
  if (typeof query !== "string" || !query.trim() || query.length > 1200) {
    throw createError({ statusCode: 400, statusMessage: "The search query must contain 1–1,200 characters." });
  }

  const { data, error } = await client
    .from("ai_api_keys")
    .select("id, model, api_key, status, last_error, created_at")
    .order("created_at", { ascending: true });
  if (error) {
    throw createError({ statusCode: 500, statusMessage: `Could not load Gemini search configuration: ${error.message}` });
  }
  if (data.length === 0) {
    throw createError({ statusCode: 400, statusMessage: "Add a Gemini API key before searching the web." });
  }

  try {
    return await searchWebWithFallback(query, data as GeminiApiKey[]);
  } catch (searchError) {
    throw createError({
      statusCode: 502,
      statusMessage:
        searchError instanceof Error
          ? searchError.message
          : "All configured web search providers failed.",
    });
  }
});
