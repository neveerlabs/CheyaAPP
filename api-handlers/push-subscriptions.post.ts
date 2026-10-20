import { createError, defineEventHandler, getHeader, readBody } from "nitro/h3";
import { createAuthenticatedServerClient, createServiceRoleClient } from "../src/lib/server-supabase";
import type { Json } from "../src/lib/supabase";

type SubscriptionRequest = {
  action?: unknown;
  subscription?: unknown;
};

function isSubscription(value: unknown): value is {
  endpoint: string;
  keys: { p256dh: string; auth: string };
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const subscription = value as Record<string, unknown>;
  if (typeof subscription.endpoint !== "string") return false;
  try {
    const endpoint = new URL(subscription.endpoint);
    if (endpoint.protocol !== "https:") return false;
  } catch {
    return false;
  }
  if (typeof subscription.keys !== "object" || subscription.keys === null) return false;
  const keys = subscription.keys as Record<string, unknown>;
  return typeof keys.p256dh === "string" && typeof keys.auth === "string";
}

export default defineEventHandler(async (event) => {
  const authorization = getHeader(event, "authorization");
  const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) {
    throw createError({ statusCode: 401, statusMessage: "Sign in before managing push notifications." });
  }

  const authClient = createAuthenticatedServerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser(accessToken);
  if (authError || !user || user.is_anonymous) {
    throw createError({ statusCode: 401, statusMessage: "Your account session is invalid or expired." });
  }

  const body = await readBody<SubscriptionRequest>(event);
  if (!body || (body.action !== "subscribe" && body.action !== "unsubscribe")) {
    throw createError({ statusCode: 400, statusMessage: "Choose subscribe or unsubscribe." });
  }

  if (body.action === "subscribe" && !isSubscription(body.subscription)) {
    throw createError({ statusCode: 400, statusMessage: "The browser push subscription is invalid." });
  }

  const serviceClient = createServiceRoleClient();
  if (body.action === "subscribe") {
    const subscription = body.subscription;
    if (!isSubscription(subscription)) {
      throw createError({ statusCode: 400, statusMessage: "The browser push subscription is invalid." });
    }
    const storedSubscription: Json = {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
    };
    const { error } = await serviceClient.from("push_subscriptions").upsert(
      {
        user_id: user.id,
        endpoint: subscription.endpoint,
        subscription: storedSubscription,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" },
    );
    if (error) throw createError({ statusCode: 500, statusMessage: `Could not save push subscription: ${error.message}` });
    return { subscribed: true };
  }

  if (!isSubscription(body.subscription)) {
    throw createError({ statusCode: 400, statusMessage: "The browser push subscription is invalid." });
  }
  const { error } = await serviceClient
    .from("push_subscriptions")
    .delete()
    .eq("user_id", user.id)
    .eq("endpoint", body.subscription.endpoint);
  if (error) throw createError({ statusCode: 500, statusMessage: `Could not remove push subscription: ${error.message}` });
  return { subscribed: false };
});
