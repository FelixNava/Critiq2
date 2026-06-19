/**
 * Free-text context (Phase 35a) — the data layer for the two human-entered context
 * blocks Critiq lets a rep add:
 *
 *   - REP-LEVEL  ("what should Critiq know about how you sell") — rep-private, one
 *     row per rep in `rep_context`. Edited from /profile.
 *   - ACCOUNT-LEVEL ("what Critiq should know about this account") — SHARED across
 *     reps (account intelligence is shared), stored on `account_records.context`.
 *     Edited from the account page; access is gated by the account assignment.
 *
 * Both feed the working-memory / coaching layers (the consumer wiring is Phase 35c)
 * and are treated as GROUNDED by the hallucination guard via synthetic source tags
 * (see src/lib/hallucinationguard/sources.ts), so a rep can add a true detail Critiq
 * doesn't yet know and have it surface in coaching without being redacted.
 *
 * Pure normalization (trim + length-clamp) is exported separately so it's unit-tested
 * without a DB. The reads/writes are the only impure part.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { accountsTbl, accountRepJoins, repContext } from "@/db/schema";

/** Length guards. Generous (this is a single open-ended block) but bounded. */
export const MAX_REP_CONTEXT = 4000;
export const MAX_ACCOUNT_CONTEXT = 4000;

/**
 * Normalize a raw context input: trim, clamp to `max`, and treat an all-whitespace
 * value as "clear it" (null). Pure — the route + tests both use it.
 */
export function normalizeContext(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (t.length === 0) return null;
  return t.slice(0, max);
}

/** Read-side coercion: a stored context value is meaningful only if it has non-whitespace. */
function emptyToNull(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v && v.length > 0 ? v : null;
}

/* ------------------------------- rep context ------------------------------- */

/** Read a rep's free-text context (null if they haven't set any). */
export async function getRepContext(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ context: repContext.context })
    .from(repContext)
    .where(eq(repContext.userId, userId))
    .limit(1);
  return emptyToNull(row?.context);
}

/**
 * Upsert a rep's free-text context. A null/empty value DELETES the row (the rep
 * cleared it). One row per rep (UNIQUE user_id) makes the upsert idempotent.
 */
export async function setRepContext(
  userId: string,
  context: string | null,
): Promise<void> {
  if (context == null) {
    await db.delete(repContext).where(eq(repContext.userId, userId));
    return;
  }
  await db
    .insert(repContext)
    .values({ userId, context })
    .onConflictDoUpdate({
      target: repContext.userId,
      set: { context, updatedAt: new Date() },
    });
}

/* ----------------------------- account context ----------------------------- */

/**
 * Read an account's shared context, but ONLY if the rep is assigned to it — the
 * inner join on `account_rep_joins` is the access boundary (same pattern as
 * getAccountForUser). Returns null when not assigned / no context set.
 */
export async function getAccountContextForUser(
  userId: string,
  accountId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ context: accountsTbl.context })
    .from(accountRepJoins)
    .innerJoin(accountsTbl, eq(accountRepJoins.accountId, accountsTbl.id))
    .where(
      and(
        eq(accountRepJoins.userId, userId),
        eq(accountRepJoins.accountId, accountId),
        isNull(accountsTbl.deletedAt),
      ),
    )
    .limit(1);
  return emptyToNull(row?.context);
}

/**
 * Set an account's shared context IF the rep is assigned to it. The UPDATE is
 * gated by an EXISTS check on the join in a single statement so a rep can't write
 * context onto an account they're not on. Returns true when a (non-deleted) row was
 * updated. The account intelligence is shared, so this is a last-writer-wins shared
 * field by design (DEC-049) — like account_records.summary.
 */
export async function setAccountContextForUser(
  userId: string,
  accountId: string,
  context: string | null,
): Promise<boolean> {
  const rows = await db
    .update(accountsTbl)
    .set({ context })
    .where(
      and(
        eq(accountsTbl.id, accountId),
        isNull(accountsTbl.deletedAt),
        sql`exists (
          select 1 from ${accountRepJoins}
          where ${accountRepJoins.accountId} = ${accountsTbl.id}
            and ${accountRepJoins.userId} = ${userId}
        )`,
      ),
    )
    .returning({ id: accountsTbl.id });
  return rows.length > 0;
}

/** Read an account's shared context directly by id (no access gate) — for server-side
 *  assembly paths (grounding/working memory) that have already authorized the rep. */
export async function getAccountContext(
  accountId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ context: accountsTbl.context })
    .from(accountsTbl)
    .where(and(eq(accountsTbl.id, accountId), isNull(accountsTbl.deletedAt)))
    .limit(1);
  return emptyToNull(row?.context);
}
