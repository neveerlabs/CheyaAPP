import { createError, defineEventHandler, getHeader, readBody } from "nitro/h3";
import { regenerateAdminRelayBody } from "../src/lib/gemini";
import { redactSensitiveText } from "../src/lib/server-ai-tools";
import {
  createAuthenticatedServerClient,
  createServiceRoleClient,
} from "../src/lib/server-supabase";
import type { GeminiApiKey } from "../src/lib/supabase";

const uuidPattern = /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

export default defineEventHandler(async (event) => {
  const accessToken = getHeader(event, "authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) {
    throw createError({ statusCode: 401, statusMessage: "Sign in before updating relay feedback." });
  }

  const authClient = createAuthenticatedServerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser(accessToken);
  if (authError || !user || user.is_anonymous) {
    throw createError({ statusCode: 401, statusMessage: "Your account session is invalid or expired." });
  }

  const input = await readBody<Record<string, unknown>>(event);
  if (
    !input ||
    typeof input.adminMessageId !== "string" ||
    !uuidPattern.test(input.adminMessageId) ||
    (input.action !== "rate" && input.action !== "report" && input.action !== "regenerate")
  ) {
    throw createError({ statusCode: 400, statusMessage: "The administrator relay action is invalid." });
  }

  const client = createServiceRoleClient();
  const [{ data: actorProfile, error: actorError }, { data: relay, error: relayError }] =
    await Promise.all([
      client.from("account_profiles").select("role").eq("user_id", user.id).single(),
      client
        .from("admin_messages")
        .select("id, sender_user_id, source_message_id, body")
        .eq("id", input.adminMessageId)
        .single(),
    ]);
  if (actorError) throw new Error(`Could not verify relay feedback account: ${actorError.message}`);
  if (relayError) throw new Error(`Could not load the administrator relay: ${relayError.message}`);
  if (actorProfile.role !== "admin" && relay.sender_user_id !== user.id) {
    throw createError({ statusCode: 403, statusMessage: "You cannot update feedback for this relay." });
  }
  if (input.action === "regenerate" && relay.sender_user_id !== user.id) {
    throw createError({
      statusCode: 403,
      statusMessage: "Only the original sender can regenerate this relay with their Gemini API key.",
    });
  }

  if (input.action === "rate") {
    if (input.rating !== null && input.rating !== "like" && input.rating !== "dislike") {
      throw createError({ statusCode: 400, statusMessage: "Choose a valid relay rating." });
    }
    if (input.rating === null) {
      const { error } = await client
        .from("admin_message_feedback")
        .delete()
        .eq("admin_message_id", relay.id)
        .eq("user_id", user.id)
        .in("kind", ["like", "dislike"]);
      if (error) throw new Error(`Could not remove relay feedback: ${error.message}`);
      return { saved: true, rating: null };
    }
    const { error } = await client.from("admin_message_feedback").upsert(
      {
        admin_message_id: relay.id,
        user_id: user.id,
        kind: input.rating,
        details: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "admin_message_id,user_id,kind" },
    );
    if (error) throw new Error(`Could not save relay feedback: ${error.message}`);
    const { error: otherRatingError } = await client
      .from("admin_message_feedback")
      .delete()
      .eq("admin_message_id", relay.id)
      .eq("user_id", user.id)
      .eq("kind", input.rating === "like" ? "dislike" : "like");
    if (otherRatingError) throw new Error(`Could not update the previous relay rating: ${otherRatingError.message}`);
    return { saved: true, rating: input.rating };
  }

  if (input.action === "report") {
    if (typeof input.details !== "string" || !input.details.trim() || input.details.trim().length > 2000) {
      throw createError({ statusCode: 400, statusMessage: "Write a report between 1 and 2000 characters." });
    }
    const { error } = await client.from("admin_message_feedback").upsert(
      {
        admin_message_id: relay.id,
        user_id: user.id,
        kind: "report",
        details: redactSensitiveText(input.details.trim()),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "admin_message_id,user_id,kind" },
    );
    if (error) throw new Error(`Could not save relay feedback report: ${error.message}`);
    return { saved: true };
  }

  if (!relay.source_message_id) {
    throw createError({
      statusCode: 409,
      statusMessage: "This older relay cannot be regenerated because its original request is not linked.",
    });
  }
  const [{ data: sourceMessage, error: sourceError }, { data: keys, error: keysError }, { data: feedback, error: feedbackError }] =
    await Promise.all([
      client
        .from("chat_messages")
        .select("content")
        .eq("id", relay.source_message_id)
        .eq("user_id", relay.sender_user_id)
        .eq("role", "user")
        .single(),
      client
        .from("ai_api_keys")
        .select("id, model, api_key, status, last_error, created_at")
        .eq("user_id", relay.sender_user_id)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true }),
      client
        .from("admin_message_feedback")
        .select("kind, details")
        .eq("admin_message_id", relay.id)
        .order("updated_at", { ascending: false }),
    ]);
  if (sourceError) throw new Error(`Could not load the original request: ${sourceError.message}`);
  if (keysError) throw new Error(`Could not load Gemini API keys: ${keysError.message}`);
  if (feedbackError) throw new Error(`Could not load relay feedback: ${feedbackError.message}`);
  if (keys.length === 0) {
    throw createError({ statusCode: 409, statusMessage: "The sender has no Gemini API key configured." });
  }

  const revisedBody = redactSensitiveText(
    await regenerateAdminRelayBody(
      keys as GeminiApiKey[],
      sourceMessage.content,
      relay.body,
      feedback,
    ),
  );
  const { data: updatedCount, error: updateError } = await client.rpc(
    "update_admin_message_relay",
    { p_admin_message_id: relay.id, p_body: revisedBody },
  );
  if (updateError) {
    throw new Error(`Could not update the administrator relay: ${updateError.message}`);
  }
  if (updatedCount < 1) {
    throw new Error("The relay was updated, but no administrator chat message was linked.");
  }
  return { regenerated: true, updatedCount, body: revisedBody };
});
