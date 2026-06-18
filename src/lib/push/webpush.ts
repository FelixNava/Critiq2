/**
 * Server-side Web Push (Phase 14 — interruption notifications). Wraps the
 * `web-push` library with Critiq's VAPID config and the BRANDING-ONLY payload
 * contract.
 *
 * PRIVACY (hard requirement): a push notification renders on a lock screen /
 * notification center where anyone can see it, so the payload carries NO call
 * content and NEVER the word "recording" — only neutral Critiq branding. The
 * service worker (public/sw.js) shows exactly what we send here.
 *
 * Graceful when unconfigured: if the VAPID env vars are absent (e.g. a preview
 * before Felix adds them to Vercel) `isPushConfigured()` is false and the send
 * helpers no-op rather than throw — so the build/runtime never depends on the
 * keys being present. Real end-to-end push is covered by the on-device gate.
 */
import webpush from "web-push";

/** BRANDING-ONLY interruption payload — no call content, never "recording". */
export const INTERRUPTION_PUSH_PAYLOAD = {
  title: "Critiq",
  body: "Critiq needs your attention.",
  tag: "critiq-interruption",
} as const;

function vapidEnv(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:notifications@critiq.firstlap.dev";
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject };
}

/**
 * True iff VAPID keys are present so the server can actually send pushes. Reads
 * env fresh each call (not memoized) so a warm serverless instance picks up a
 * key rotation the same way the /api/push/vapid route does — a stale cached
 * keypair would silently sign pushes the push service rejects after a rotation.
 * setVapidDetails just stores the keys in the lib, so re-calling is cheap.
 */
export function isPushConfigured(): boolean {
  const env = vapidEnv();
  if (!env) return false;
  try {
    webpush.setVapidDetails(env.subject, env.publicKey, env.privateKey);
  } catch {
    // Malformed keys — treat as unconfigured rather than throwing into a send.
    return false;
  }
  return true;
}

/** The public VAPID key the client needs to subscribe, or null if unconfigured. */
export function getPublicVapidKey(): string | null {
  return vapidEnv()?.publicKey ?? null;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type PushSendOutcome =
  | { endpoint: string; ok: true }
  | { endpoint: string; ok: false; gone: boolean };

/**
 * Send the branding-only interruption push to one endpoint. Returns whether it
 * succeeded and, on failure, whether the endpoint is GONE (404/410 → the caller
 * should prune it). Never throws.
 */
export async function sendInterruptionPushTo(
  target: PushTarget,
): Promise<PushSendOutcome> {
  if (!isPushConfigured()) return { endpoint: target.endpoint, ok: false, gone: false };
  try {
    await webpush.sendNotification(
      {
        endpoint: target.endpoint,
        keys: { p256dh: target.p256dh, auth: target.auth },
      },
      JSON.stringify(INTERRUPTION_PUSH_PAYLOAD),
    );
    return { endpoint: target.endpoint, ok: true };
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    const gone = statusCode === 404 || statusCode === 410;
    return { endpoint: target.endpoint, ok: false, gone };
  }
}
