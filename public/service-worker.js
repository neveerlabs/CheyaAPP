self.addEventListener("push", (event) => {
  if (!event.data) return;
  const payload = event.data.json();
  const target = new URL(payload.url || "/", self.location.origin);
  if (target.origin !== self.location.origin) target.href = self.location.origin;
  event.waitUntil(
    self.registration.showNotification(payload.title || "Cheya", {
      body: payload.body || "You have a new reminder.",
      icon: "/circle.png",
      badge: "/circle.png",
      data: { url: target.href },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/", self.location.origin);
  if (targetUrl.origin !== self.location.origin) targetUrl.href = self.location.origin;
  targetUrl.searchParams.set("inbox", "1");
  const target = targetUrl.href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => client.url.startsWith(self.location.origin));
      if (existing) {
        return existing
          .navigate(target)
          .then((client) => {
            if (!client) return self.clients.openWindow(target);
            client.postMessage({ type: "OPEN_NOTIFICATION_INBOX" });
            return client.focus();
          });
      }
      return self.clients.openWindow(target);
    }),
  );
});
