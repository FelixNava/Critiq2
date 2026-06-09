/**
 * Web Push client (Phase 14, channel c). Registers the service worker, manages
 * the rep's push subscription, and exposes the push NotificationChannel the
 * interruption monitor drives.
 *
 * Web Push matters when the rep has tabbed/locked away and the in-page channels
 * (chime / banner / tab-flash) can't run — exactly the interruption case on
 * mobile. On iOS this requires the app be INSTALLED as a PWA (Add to Home
 * Screen); elsewhere it works in the browser. The channel's raise() asks the
 * server to push to this rep's own devices.
 *
 * All functions degrade gracefully: missing APIs / unconfigured VAPID / denied
 * permission resolve to a typed status rather than throwing.
 */

export type PushSupport =
  | "supported"
  | "unsupported" // browser lacks SW/Push/Notification APIs
  | "needs-install"; // iOS Safari: push only works once installed as a PWA

export type PushEnableResult =
  | { ok: true }
  | { ok: false; reason: "unsupported" | "needs-install" | "denied" | "unconfigured" | "error" };

export function isPushApiSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** True when running as an installed PWA (standalone display). */
export function isPwaInstalled(): boolean {
  if (typeof window === "undefined") return false;
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches;
  // iOS Safari exposes a non-standard navigator.standalone.
  const iosStandalone = (navigator as unknown as { standalone?: boolean }).standalone;
  return Boolean(standalone || iosStandalone);
}

/** Rough iOS detection (iPhone/iPad) for the "install first" guidance. */
function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const iPadOs = ua.includes("Macintosh") && "ontouchend" in document;
  return /iPad|iPhone|iPod/.test(ua) || iPadOs;
}

export function pushSupport(): PushSupport {
  if (!isPushApiSupported()) {
    // iOS only gained PushManager inside installed PWAs — if we're on iOS in a
    // plain Safari tab, the right guidance is "install first", not "unsupported".
    if (isIos() && !isPwaInstalled()) return "needs-install";
    return "unsupported";
  }
  if (isIos() && !isPwaInstalled()) return "needs-install";
  return "supported";
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch {
    return null;
  }
}

async function fetchVapidPublicKey(): Promise<string | null> {
  try {
    const res = await fetch("/api/push/vapid");
    if (!res.ok) return null;
    const data = (await res.json()) as { publicKey?: string | null };
    return data.publicKey ?? null;
  } catch {
    return null;
  }
}

/** VAPID public key (base64url) → the Uint8Array applicationServerKey wants. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Register the SW, request notification permission, subscribe, and persist the
 * subscription server-side. Returns a typed result the UI maps to copy.
 */
export async function enablePush(): Promise<PushEnableResult> {
  const support = pushSupport();
  if (support !== "supported") return { ok: false, reason: support };

  const reg = await registerServiceWorker();
  if (!reg) return { ok: false, reason: "error" };

  let permission = Notification.permission;
  if (permission === "default") permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "denied" };

  const publicKey = await fetchVapidPublicKey();
  if (!publicKey) return { ok: false, reason: "unconfigured" };

  try {
    const existing = await reg.pushManager.getSubscription();
    const subscription =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      }));

    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    });
    if (!res.ok) return { ok: false, reason: "error" };
    return { ok: true };
  } catch {
    return { ok: false, reason: "error" };
  }
}

/** Unsubscribe locally + server-side. Best-effort. */
export async function disablePush(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe().catch(() => {});
      await fetch("/api/push/unsubscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint }),
      }).catch(() => {});
    }
  } catch {
    // best-effort
  }
}

/**
 * The push NotificationChannel: raise() asks the server to push the
 * branding-only interruption alert to this rep's devices. Fire-and-forget — a
 * failed/short-lived request must never wedge the recorder. clear() is a no-op
 * (a push is a one-shot; there's nothing to retract).
 */
export function createPushChannel(): {
  raise(): void;
  clear(): void;
} {
  return {
    raise() {
      if (typeof fetch === "undefined") return;
      // Skip the round-trip when push can't have a subscription: notifications
      // are opt-in, so if permission isn't granted there are no endpoints to
      // reach. This keeps a flapping mic from hammering /api/push/notify (auth +
      // DB lookup) on the recorder's hot path for the common not-enabled case.
      if (typeof Notification === "undefined" || Notification.permission !== "granted") {
        return;
      }
      void fetch("/api/push/notify", { method: "POST" }).catch(() => {});
    },
    clear() {
      // one-shot
    },
  };
}
