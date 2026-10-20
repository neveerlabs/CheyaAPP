import webPush from "web-push";
import type { Json } from "./supabase";
import { createServiceRoleClient, getServerEnvironmentVariable } from "./server-supabase";

type StoredPushSubscription = {
  id: string;
  subscription: Json;
};

export type PushDeliveryReport = {
  attempted: number;
  sent: number;
  failed: string[];
  skippedActive?: boolean;
};

function parseSubscription(value: Json): webPush.PushSubscription | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const endpoint = value.endpoint;
  const keys = value.keys;
  if (
    typeof endpoint !== "string" ||
    typeof keys !== "object" ||
    keys === null ||
    Array.isArray(keys) ||
    typeof keys.p256dh !== "string" ||
    typeof keys.auth !== "string"
  ) {
    return null;
  }
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

function vapidConfiguration() {
  const publicKey = getServerEnvironmentVariable("VAPID_PUBLIC_KEY");
  const privateKey = getServerEnvironmentVariable("VAPID_PRIVATE_KEY");
  const subject = getServerEnvironmentVariable("VAPID_SUBJECT");
  if (!publicKey || !privateKey || !subject) {
    throw new Error("VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT must be configured.");
  }
  return { publicKey, privateKey, subject };
}

export async function isAccountActiveInChat(userId: string): Promise<boolean> {
  const client = createServiceRoleClient();
  const activeSince = new Date(Date.now() - 45_000).toISOString();
  const { data, error } = await client
    .from("account_sessions")
    .select("path")
    .eq("user_id", userId)
    .eq("is_active", true)
    .eq("path", "/")
    .gt("last_seen_at", activeSince)
    .limit(1);
  if (error) throw new Error(`Could not check active chat sessions before push delivery: ${error.message}`);
  return data.length > 0;
}

export async function sendAiFailureToInbox(
  userId: string,
  jobId: string,
  message: string,
): Promise<void> {
  const client = createServiceRoleClient();
  const body = message.slice(0, 10000);
  const { data, error } = await client
    .from("account_inbox")
    .upsert(
      {
        recipient_user_id: userId,
        source_job_id: jobId,
        kind: "ai_error",
        title: "Cheya couldn't reply",
        body,
      },
      { onConflict: "source_job_id", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Could not save the AI error to the inbox: ${error.message}`);
  if (!data) return;

  try {
    const push = await sendPushToAccount(userId, "Cheya couldn't reply", body);
    if (push.failed.length > 0) {
      console.error("The AI error was saved to the inbox, but its push notification failed.", push.failed);
    }
  } catch (pushError) {
    console.error("The AI error was saved to the inbox, but its push notification failed.", pushError);
  }
}

export async function sendPushToAccount(
  userId: string,
  title: string,
  body: string,
): Promise<PushDeliveryReport> {
  if (await isAccountActiveInChat(userId)) {
    return { attempted: 0, sent: 0, failed: [], skippedActive: true };
  }

  const client = createServiceRoleClient();
  const { data, error } = await client
    .from("push_subscriptions")
    .select("id, subscription")
    .eq("user_id", userId);
  if (error) throw new Error(`Could not load account push subscriptions: ${error.message}`);
  const subscriptions: StoredPushSubscription[] = data;
  if (subscriptions.length === 0) return { attempted: 0, sent: 0, failed: [] };

  const vapid = vapidConfiguration();
  webPush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  const notificationTitle = title.slice(0, 80);
  const notificationBody = body.length > 800 ? `${body.slice(0, 797)}...` : body;
  const payload = JSON.stringify({ title: notificationTitle, body: notificationBody, url: "/" });
  let sent = 0;
  const failed: string[] = [];
  await Promise.all(
    subscriptions.map(async (subscription) => {
      const pushSubscription = parseSubscription(subscription.subscription);
      if (!pushSubscription) {
        failed.push(`Push subscription ${subscription.id} is invalid.`);
        return;
      }
      try {
        await webPush.sendNotification(pushSubscription, payload);
        sent += 1;
      } catch (error) {
        const statusCode =
          typeof error === "object" &&
          error !== null &&
          "statusCode" in error &&
          typeof error.statusCode === "number"
            ? error.statusCode
            : null;
        if (statusCode === 404 || statusCode === 410) {
          const { error: deleteError } = await client
            .from("push_subscriptions")
            .delete()
            .eq("id", subscription.id)
            .eq("user_id", userId);
          if (deleteError) {
            failed.push(`Could not remove expired push subscription ${subscription.id}: ${deleteError.message}`);
          }
          return;
        }
        failed.push(
          `Push delivery failed${statusCode ? ` (${statusCode})` : ""}: ${
            error instanceof Error ? error.message : "Unknown push service error."
          }`,
        );
      }
    }),
  );
  return { attempted: subscriptions.length, sent, failed };
}

export async function sendPushToAccounts(
  userIds: string[],
  title: string,
  body: string,
): Promise<PushDeliveryReport> {
  const reports = await Promise.all(
    [...new Set(userIds)].map(async (userId) => {
      try {
        return await sendPushToAccount(userId, title, body);
      } catch (error) {
        return {
          attempted: 0,
          sent: 0,
          failed: [
            `Could not deliver push notification to account ${userId}: ${
              error instanceof Error ? error.message : "Unknown push service error."
            }`,
          ],
          skippedActive: false,
        };
      }
    }),
  );
  return {
    attempted: reports.reduce((sum, report) => sum + report.attempted, 0),
    sent: reports.reduce((sum, report) => sum + report.sent, 0),
    failed: reports.flatMap((report) => report.failed),
    skippedActive: reports.some((report) => report.skippedActive),
  };
}
