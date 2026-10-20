import type { AppSupabaseClient } from "./supabase";

function decodeApplicationServerKey(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

export async function enablePushForCurrentDevice(client: AppSupabaseClient): Promise<void> {
  if (
    !("Notification" in window) ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window)
  ) {
    throw new Error("This browser does not support push notifications.");
  }

  const permission =
    Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "Notifications are blocked. Allow them in your browser or device settings, then try again."
        : "Allow notifications to enable account alerts.",
    );
  }

  const registration = await navigator.serviceWorker.register("/service-worker.js");
  const configResponse = await fetch("/api/push-config");
  const configPayload: unknown = await configResponse.json().catch(() => null);
  if (!configResponse.ok) {
    const message =
      typeof configPayload === "object" &&
      configPayload !== null &&
      "statusMessage" in configPayload &&
      typeof configPayload.statusMessage === "string"
        ? configPayload.statusMessage
        : `Could not load push notification configuration (${configResponse.status}).`;
    throw new Error(message);
  }
  if (
    typeof configPayload !== "object" ||
    configPayload === null ||
    !("publicKey" in configPayload) ||
    typeof configPayload.publicKey !== "string"
  ) {
    throw new Error("The push notification service returned an invalid public key.");
  }

  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeApplicationServerKey(configPayload.publicKey),
    }));
  await saveSubscription(client, "subscribe", subscription);
}

export async function syncCurrentPushSubscription(
  client: AppSupabaseClient,
): Promise<boolean> {
  if (
    !("Notification" in window) ||
    Notification.permission !== "granted" ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window)
  ) {
    return false;
  }
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return false;
  await saveSubscription(client, "subscribe", subscription);
  return true;
}

export async function disablePushForCurrentDevice(client: AppSupabaseClient): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await saveSubscription(client, "unsubscribe", subscription);
  await subscription.unsubscribe();
}

async function saveSubscription(
  client: AppSupabaseClient,
  action: "subscribe" | "unsubscribe",
  subscription: PushSubscription,
): Promise<void> {
  const {
    data: { session },
    error,
  } = await client.auth.getSession();
  if (error) throw error;
  if (!session?.access_token) throw new Error("Your account session has expired. Sign in again.");
  const response = await fetch("/api/push-subscriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, subscription: subscription.toJSON() }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "statusMessage" in payload &&
      typeof payload.statusMessage === "string"
        ? payload.statusMessage
        : `Could not update push notifications (${response.status}).`;
    throw new Error(message);
  }
}
