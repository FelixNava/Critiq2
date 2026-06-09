/**
 * Push subscription data layer (Phase 14). Thin, typed helpers the push API
 * routes call. Subscriptions are scoped to the rep (ownership = the access
 * boundary, mirroring src/lib/recordings.ts). `endpoint` is the natural key: a
 * browser that re-subscribes upserts in place rather than duplicating.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import {
  sendInterruptionPushTo,
  type PushTarget,
} from "./webpush";

export interface SubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
}

/** A browser PushSubscription JSON, validated into our SubscriptionInput. */
export function parseSubscription(value: unknown): SubscriptionInput | null {
  if (!value || typeof value !== "object") return null;
  const v = value as {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown } | null;
  };
  const endpoint = typeof v.endpoint === "string" ? v.endpoint : null;
  const p256dh =
    v.keys && typeof v.keys.p256dh === "string" ? v.keys.p256dh : null;
  const auth = v.keys && typeof v.keys.auth === "string" ? v.keys.auth : null;
  if (!endpoint || !p256dh || !auth) return null;
  // A modest sanity bound — a real endpoint is a URL well under this.
  if (endpoint.length > 2048 || p256dh.length > 512 || auth.length > 512) {
    return null;
  }
  return { endpoint, p256dh, auth };
}

/** Upsert a subscription for a rep (idempotent on endpoint). */
export async function saveSubscription(
  userId: string,
  input: SubscriptionInput,
): Promise<void> {
  await db
    .insert(pushSubscriptions)
    .values({
      userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent ?? null,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent ?? null,
      },
    });
}

/** Remove a subscription by endpoint, scoped to the rep that owns it. */
export async function deleteSubscription(
  userId: string,
  endpoint: string,
): Promise<void> {
  await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.userId, userId),
        eq(pushSubscriptions.endpoint, endpoint),
      ),
    );
}

/** Prune endpoints that the push service reported as gone (404/410). */
export async function pruneEndpoints(endpoints: string[]): Promise<void> {
  if (endpoints.length === 0) return;
  await db
    .delete(pushSubscriptions)
    .where(inArray(pushSubscriptions.endpoint, endpoints));
}

export async function listTargetsForUser(userId: string): Promise<PushTarget[]> {
  const rows = await db
    .select({
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
  return rows;
}

export interface InterruptionPushResult {
  attempted: number;
  delivered: number;
}

/**
 * Send the branding-only interruption push to every endpoint a rep has
 * registered, pruning any that come back gone. Safe to call when push is
 * unconfigured (returns attempted=0). The rep notifies their OWN devices — this
 * is the client interruption monitor asking the server to reach a backgrounded
 * PWA where the in-page channels (chime/banner/tab-flash) can't run.
 */
export async function sendInterruptionPush(
  userId: string,
): Promise<InterruptionPushResult> {
  const targets = await listTargetsForUser(userId);
  if (targets.length === 0) return { attempted: 0, delivered: 0 };

  const outcomes = await Promise.all(targets.map(sendInterruptionPushTo));
  const gone = outcomes
    .filter((o) => !o.ok && o.gone)
    .map((o) => o.endpoint);
  if (gone.length) await pruneEndpoints(gone);

  return {
    attempted: targets.length,
    delivered: outcomes.filter((o) => o.ok).length,
  };
}
