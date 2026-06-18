/**
 * Account consolidation data layer (Phase 23). Thin typed helpers over the
 * account_summaries table + the cross-rep debrief reads the consolidator needs.
 *
 * The summary row is UNIQUE per account, so claiming it for processing is idempotent
 * — a concurrent debrief-trigger + cron can't double-consolidate. Same CAS-claim /
 * attempts-cap / stale-reclaim shape as src/lib/scoring/store.ts, with one addition:
 * NEW MATERIAL (the account's completed-debrief count exceeds the count the summary
 * was last built from) resets the attempts budget, so a fresh debrief always gets a
 * clean retry while a persistently-failing SAME-material run stays bounded.
 *
 * On finish, the narrative is mirrored into account_records.summary (the shared
 * intelligence field reserved since Phase 9 for "a later AI intelligence phase") so
 * the per-account intelligence card surfaces it with no new UI.
 */

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accountSummaries,
  accountsTbl,
  callDebriefs,
  type AccountSummary,
} from "@/db/schema";
import type { AccountFact, DebriefDigest } from "./types";

/** A processing claim older than this is a dead run and reclaimable. */
export const STALE_PROCESSING_MS = 15 * 60 * 1000; // 15 min

/**
 * The cron sweeper stops auto-retrying the SAME material once attempts hits this cap
 * (bounded loss, like MAX_SCORING_ATTEMPTS). NEW material resets the counter, and a
 * human can re-trigger via a fresh debrief. */
export const MAX_CONSOLIDATION_ATTEMPTS = 3;

/** Read an account's summary row (null if none yet). */
export async function getAccountSummary(
  accountId: string,
): Promise<AccountSummary | null> {
  const [row] = await db
    .select()
    .from(accountSummaries)
    .where(eq(accountSummaries.accountId, accountId))
    .limit(1);
  return row ?? null;
}

/**
 * Count an account's COMPLETED debriefs — across ALL reps (account intelligence is
 * shared). This count is the "new material" signal: when it exceeds the count the
 * summary was last built from, there's something new to consolidate.
 */
export async function countCompletedDebriefs(
  accountId: string,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(callDebriefs)
    .where(
      and(
        eq(callDebriefs.accountId, accountId),
        eq(callDebriefs.status, "completed"),
      ),
    );
  return row?.n ?? 0;
}

/**
 * The account's completed debriefs the consolidator reads — NEWEST FIRST, across all
 * reps, bounded by `limit` (the prompt-size cap). Returns the distilled Phase 20
 * structured output (not the raw report); the runner assigns the "D1"/"D2" labels.
 * jsonb arrays are coerced defensively (the same `?? []` the debrief page uses).
 */
export async function getCompletedDebriefsForConsolidation(
  accountId: string,
  limit: number,
): Promise<Omit<DebriefDigest, "label">[]> {
  const rows = await db
    .select({
      debriefId: callDebriefs.id,
      occurredAt: callDebriefs.completedAt,
      createdAt: callDebriefs.createdAt,
      recap: callDebriefs.recap,
      observations: callDebriefs.observations,
      commitments: callDebriefs.commitments,
      openQuestions: callDebriefs.openQuestions,
      summary: callDebriefs.summary,
    })
    .from(callDebriefs)
    .where(
      and(
        eq(callDebriefs.accountId, accountId),
        eq(callDebriefs.status, "completed"),
      ),
    )
    // NULLS LAST so a (defensively-possible) completed debrief with a null
    // completedAt can't sort to the top and be mistaken for the newest call.
    .orderBy(
      sql`${callDebriefs.completedAt} DESC NULLS LAST`,
      desc(callDebriefs.createdAt),
    )
    .limit(limit);

  return rows.map((r) => ({
    debriefId: r.debriefId,
    // completedAt is set when a debrief completes, but fall back to createdAt defensively.
    occurredAt: r.occurredAt ?? r.createdAt,
    recap: r.recap,
    observations: coerceObservations(r.observations),
    commitments: coerceStringArray(r.commitments),
    openQuestions: coerceStringArray(r.openQuestions),
    summary: r.summary,
  }));
}

function coerceStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

function coerceObservations(
  v: unknown,
): { note: string; lens: DebriefDigest["observations"][number]["lens"] }[] {
  if (!Array.isArray(v)) return [];
  const out: { note: string; lens: DebriefDigest["observations"][number]["lens"] }[] =
    [];
  for (const item of v) {
    const o = (item ?? {}) as Record<string, unknown>;
    const note = typeof o.note === "string" ? o.note.trim() : "";
    if (!note) continue;
    // The lens is already a validated ObservationLens (Phase 20 normalized it before
    // storing) and is only model-input context here, not stored output — so keep the
    // stored string; if it's missing, default to "general".
    const lensRaw = typeof o.lens === "string" ? o.lens : "general";
    out.push({
      note,
      lens: lensRaw as DebriefDigest["observations"][number]["lens"],
    });
  }
  return out;
}

export type ClaimResult =
  | { claimed: true; summaryId: string }
  | {
      claimed: false;
      reason: "current" | "in-progress" | "exhausted";
      summaryId: string;
    };

/**
 * Claim an account's summary row for processing, idempotently. Inserts the row if
 * absent. Compare-and-swap on (status, startedAt) closes the SELECT-then-UPDATE race
 * between the debrief trigger and the cron.
 *
 * `currentDebriefCount` is the account's live completed-debrief count. When it exceeds
 * the count the row was last built from, this is NEW material → the claim resets
 * attempts to 1 (a fresh debrief always gets a clean shot). Otherwise it's a retry of
 * the same material → attempts increments and the cap applies.
 */
export async function claimConsolidation(
  accountId: string,
  currentDebriefCount: number,
  nowMs = Date.now(),
): Promise<ClaimResult> {
  await db
    .insert(accountSummaries)
    .values({ accountId, status: "pending" })
    .onConflictDoNothing({ target: accountSummaries.accountId });

  const [row] = await db
    .select()
    .from(accountSummaries)
    .where(eq(accountSummaries.accountId, accountId))
    .limit(1);

  if (!row) {
    throw new Error("Failed to create account summary row.");
  }

  const isNewMaterial = currentDebriefCount > row.debriefCount;

  // Already reflects the latest material — nothing to do.
  if (row.status === "completed" && !isNewMaterial) {
    return { claimed: false, reason: "current", summaryId: row.id };
  }
  // A fresh run is in flight — let it finish.
  if (row.status === "processing") {
    const startedMs = row.startedAt ? row.startedAt.getTime() : 0;
    if (nowMs - startedMs < STALE_PROCESSING_MS) {
      return { claimed: false, reason: "in-progress", summaryId: row.id };
    }
    // else: stale processing claim — fall through and re-claim.
  }
  // Same material that has burned through its retry budget — stop (bounded loss).
  if (!isNewMaterial && row.attempts >= MAX_CONSOLIDATION_ATTEMPTS) {
    return { claimed: false, reason: "exhausted", summaryId: row.id };
  }

  const nextAttempts = isNewMaterial ? 1 : row.attempts + 1;

  const claimed = await db
    .update(accountSummaries)
    .set({
      status: "processing",
      startedAt: new Date(nowMs),
      attempts: nextAttempts,
      error: null,
      updatedAt: new Date(nowMs),
    })
    .where(
      and(
        eq(accountSummaries.id, row.id),
        eq(accountSummaries.status, row.status),
        row.startedAt
          ? eq(accountSummaries.startedAt, row.startedAt)
          : isNull(accountSummaries.startedAt),
      ),
    )
    .returning({ id: accountSummaries.id });

  if (claimed.length === 0) {
    return { claimed: false, reason: "in-progress", summaryId: row.id };
  }
  return { claimed: true, summaryId: row.id };
}

export interface FinishConsolidationInput {
  headline: string;
  narrative: string;
  /** Facts with REAL debrief ids (the runner has already mapped labels → ids). */
  facts: AccountFact[];
  /** How many completed debriefs this summary was built from (the new-material mark). */
  debriefCount: number;
  /** The completedAt of the newest debrief included (provenance / display). */
  consolidatedThroughAt: Date | null;
}

/**
 * Persist a completed consolidation AND mirror the narrative into
 * account_records.summary so the per-account intelligence card surfaces it. Both
 * writes run in one db.batch (neon-http's atomic primitive — no interactive
 * transaction) so the structured row and the displayed summary can't diverge.
 *
 * The account write-back deliberately does NOT touch account_records.updatedAt: this
 * is a background job (often triggered by another rep's debrief), and bumping
 * updatedAt would reorder every assigned rep's account list by AI timing rather than
 * real rep activity (listAccountsForUser orders by updatedAt). It is also guarded by
 * `deletedAt IS NULL` so a run that finishes after the account was soft-deleted
 * mid-flight can't write a fresh summary onto — and partially resurrect — a deleted
 * account (the cron work list already excludes deleted accounts; this closes the race).
 */
export async function finishConsolidation(
  summaryId: string,
  accountId: string,
  input: FinishConsolidationInput,
): Promise<void> {
  const now = new Date();
  await db.batch([
    db
      .update(accountSummaries)
      .set({
        status: "completed",
        headline: input.headline,
        narrative: input.narrative,
        facts: input.facts,
        debriefCount: input.debriefCount,
        consolidatedThroughAt: input.consolidatedThroughAt,
        error: null,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(accountSummaries.id, summaryId)),
    db
      .update(accountsTbl)
      .set({ summary: input.narrative })
      .where(and(eq(accountsTbl.id, accountId), isNull(accountsTbl.deletedAt))),
  ]);
}

/** Mark a consolidation failed (the run threw before producing a result). */
export async function failConsolidation(
  summaryId: string,
  message: string,
): Promise<void> {
  await db
    .update(accountSummaries)
    .set({
      status: "failed",
      error: message.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(eq(accountSummaries.id, summaryId));
}

/** The summary fields the eligibility decision needs (null when no summary row yet). */
export interface EligibilitySummary {
  status: string;
  attempts: number;
  debriefCount: number;
  startedAt: Date | null;
}

/**
 * The single source of the "should this account be (re)consolidated?" decision —
 * pure, so it's unit-tested directly. Used to filter the cron work list;
 * claimConsolidation is the final idempotent arbiter (mirrors scoring's
 * findRecordingsNeedingScoring + claimScore split). An account qualifies when it has
 * at least one completed debrief AND one of: never consolidated · NEW material
 * (completed count > the summary's recorded count) · a pending/failed retry under the
 * cap · a stale processing claim (a dead run). A summary that is completed-and-current
 * or processing by a FRESH run is excluded. `isNewMaterial` is surfaced because new
 * material resets the attempts budget at claim time.
 */
export function consolidationEligibility(
  summary: EligibilitySummary | null,
  completedDebriefCount: number,
  nowMs = Date.now(),
): { eligible: boolean; isNewMaterial: boolean } {
  // This mirrors claimConsolidation's branch order EXACTLY so the work list never
  // surfaces an account the claim would then refuse (which would waste a bounded
  // sweep slot and could starve other eligible accounts).
  if (completedDebriefCount <= 0) return { eligible: false, isNewMaterial: false };
  if (!summary) return { eligible: true, isNewMaterial: true };

  const isNewMaterial = completedDebriefCount > summary.debriefCount;

  // Already reflects the latest material.
  if (summary.status === "completed" && !isNewMaterial) {
    return { eligible: false, isNewMaterial };
  }
  // A fresh run is in flight — let it finish.
  const startedMs = summary.startedAt ? summary.startedAt.getTime() : 0;
  const staleProcessing =
    summary.status === "processing" &&
    nowMs - startedMs >= STALE_PROCESSING_MS;
  if (summary.status === "processing" && !staleProcessing) {
    return { eligible: false, isNewMaterial };
  }
  // Same material that has burned through its retry budget — bounded loss. This
  // covers pending/failed AND a stale-processing row at the cap (claim → 'exhausted').
  if (!isNewMaterial && summary.attempts >= MAX_CONSOLIDATION_ATTEMPTS) {
    return { eligible: false, isNewMaterial };
  }
  // New material (claim resets attempts), an under-cap retry, or a stale reclaim.
  return { eligible: true, isNewMaterial };
}

/**
 * Accounts that need (re)consolidation — the cron sweeper's work list. Computed from
 * two simple query-builder reads (no raw SQL, no correlated subquery — sidesteps the
 * Drizzle bare-column gotcha): the per-account completed-debrief counts (joined to
 * account_records so soft-deleted accounts drop out) and the summary rows. The pure
 * `consolidationEligibility` decides; claimConsolidation is the final arbiter. Bounded
 * by `limit`, most-completed-debriefs first.
 */
export async function findAccountsNeedingConsolidation(
  limit = 5,
  nowMs = Date.now(),
): Promise<string[]> {
  const counts = await db
    .select({
      accountId: callDebriefs.accountId,
      n: sql<number>`count(*)::int`,
    })
    .from(callDebriefs)
    .innerJoin(accountsTbl, eq(accountsTbl.id, callDebriefs.accountId))
    .where(
      and(
        eq(callDebriefs.status, "completed"),
        isNull(accountsTbl.deletedAt),
      ),
    )
    .groupBy(callDebriefs.accountId);

  if (counts.length === 0) return [];

  // Only the accounts that actually have completed debriefs can need consolidation,
  // so scope the summary read to them (bounded) rather than scanning the whole table.
  const candidateIds = counts.map((c) => c.accountId);
  const summaryRows = await db
    .select({
      accountId: accountSummaries.accountId,
      status: accountSummaries.status,
      attempts: accountSummaries.attempts,
      debriefCount: accountSummaries.debriefCount,
      startedAt: accountSummaries.startedAt,
    })
    .from(accountSummaries)
    .where(inArray(accountSummaries.accountId, candidateIds));
  const byAccount = new Map(summaryRows.map((r) => [r.accountId, r]));

  const eligible = counts
    .filter((c) => {
      const summary = byAccount.get(c.accountId) ?? null;
      return consolidationEligibility(summary, c.n, nowMs).eligible;
    })
    // Most-active accounts first (deterministic, by id as the tiebreak).
    .sort((a, b) => b.n - a.n || a.accountId.localeCompare(b.accountId))
    .slice(0, limit)
    .map((c) => c.accountId);

  return eligible;
}
