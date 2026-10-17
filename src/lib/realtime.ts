import { REALTIME_SUBSCRIBE_STATES } from "@supabase/supabase-js";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { AppSupabaseClient } from "./supabase";

type ChannelStatusCallback = Parameters<RealtimeChannel["subscribe"]>[0];

export function subscribeWithReconnect(
  client: AppSupabaseClient,
  channelName: string,
  configure: (channel: RealtimeChannel) => RealtimeChannel,
  onStatus?: ChannelStatusCallback,
): () => void {
  let channel: RealtimeChannel | null = null;
  let retryTimer: number | null = null;
  let retryAttempt = 0;
  let generation = 0;
  let isDisposed = false;

  function removeCurrentChannel() {
    generation += 1;
    const currentChannel = channel;
    channel = null;
    if (currentChannel) void client.removeChannel(currentChannel);
  }

  function connect() {
    if (isDisposed || !navigator.onLine) return;

    const currentGeneration = ++generation;
    channel = configure(client.channel(channelName)).subscribe((status, error) => {
      if (isDisposed || currentGeneration !== generation) return;
      onStatus?.(status, error);
      if (status === "SUBSCRIBED") {
        retryAttempt = 0;
        return;
      }
      if (status !== "CHANNEL_ERROR" && status !== "TIMED_OUT" && status !== "CLOSED") {
        return;
      }
      if (retryTimer !== null || isDisposed) return;

      removeCurrentChannel();
      const delay = Math.min(250 * 2 ** retryAttempt, 4_000);
      retryAttempt += 1;
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        connect();
      }, delay);
    });
  }

  function handleOnline() {
    if (isDisposed) return;
    if (retryTimer !== null) {
      window.clearTimeout(retryTimer);
      retryTimer = null;
    }
    removeCurrentChannel();
    retryAttempt = 0;
    connect();
  }

  function handleOffline() {
    if (isDisposed) return;
    onStatus?.(
      REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR,
      new Error("The browser is offline."),
    );
    removeCurrentChannel();
  }

  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);
  connect();

  return () => {
    isDisposed = true;
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
    if (retryTimer !== null) window.clearTimeout(retryTimer);
    retryTimer = null;
    removeCurrentChannel();
  };
}
