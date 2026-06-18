/*
 * Critiq service worker (Phase 14 — Web Push for capture-interruption alerts).
 *
 * PRIVACY (hard requirement): the notification this shows renders on a lock
 * screen / notification center that other people can see. It carries ONLY
 * neutral Critiq branding — never the word "recording" and never any call
 * content. The server payload (lib/push/webpush.ts INTERRUPTION_PUSH_PAYLOAD) is
 * already branding-only; this SW does not add anything that could leak.
 *
 * Plain JS, no build step — served as a static asset from /sw.js so its scope is
 * the whole origin.
 */

self.addEventListener("install", () => {
  // Activate this SW immediately so push works on the first visit after install.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    if (event.data) payload = event.data.json();
  } catch {
    payload = {};
  }

  // Branding-only fallbacks. We intentionally do NOT echo arbitrary fields that
  // could carry text beyond title/body/tag.
  const title = typeof payload.title === "string" ? payload.title : "Critiq";
  const body =
    typeof payload.body === "string"
      ? payload.body
      : "Critiq needs your attention.";
  const tag =
    typeof payload.tag === "string" ? payload.tag : "critiq-interruption";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      renotify: true,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      // Re-open the app where the rep can act on the interruption.
      data: { url: "/recording-lab" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if ("focus" in client) return client.focus();
        }
        if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
        return undefined;
      }),
  );
});
