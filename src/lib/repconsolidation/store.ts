/**
 * Rep consolidation data layer (Phase 24). Thin typed helpers over the rep_summaries
 * table + the rep's cross-account debrief reads the consolidator needs.
 *
 * The summary row is UNIQUE per rep, so claiming it for processing is idempotent — a
 * concurrent debrief-trigger + cron can't double-consolidate. Same CAS-claim / attempts-
 * cap / stale-reclaim shape as src/lib/consolidation/store.ts, with ONE difference: the
 * "new material" signal is the locked EVERY-10-DEBRIEFS cadence, not every debrief. A
 * rep qualifies when they cross a new multiple of REP_CONSOLIDATION_INTERVAL (10, 20, 30
 * …) since the profile was last built — `debriefCount` stores that threshold, so the
 * profile regenerates at 10 / 20 / 30, never on the in-between debriefs.
 *
 * Unlike the account summary, the rep profile is REP-PRIVATE: it is NOT mirrored into any
 * shared/displayed field. It is stored here and consumed by working-memory assembly
 * (Phase 25), so finish is a single row update (no db.batch / no write-back).
 */

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accountsTbl,
  callDebriefs,
  repSummaries,
  type RepSummary,
} from "@/db/schema";
import type { RepTrait, RepDebriefDigest } from "./types";
import { REP_CONSOLIDATION_INTERVAL } from "./types";

/** A processing claim older than this is a dead run and reclaimable. */
export const STALE_PROCESSING_MS = 15 * 60 * 1000; // 15 min

/**
 * The cron sweeper stops auto-retrying the SAME threshold once attempts hits this cap
 * (bounded loss, like MAX_CONSOLIDATION_ATTEMPTS). A NEW threshold resets the counter,
 * and a human can re-trigger by crossing the next interval.
 */
export const MAX_REP_CONSOLIDATION_ATTEMPTS = 3;

/**
 * The consolidation "high-water mark" for a given completed-debrief count: the largest
 * multiple of the interval at or below it. 0 below the first interval (no learned
 * profile yet — the static intake carries the rep). This is what `debriefCount` stores
 * and what new-material detection compares against, so the profile regenerates exactly
 * at 10 / 20 / 30 …, not on the in-between debriefs.
 */
export function repConsolidationThreshold(completedDebriefCount: number): number {
  if (!Number.isFinite(completedDebriefCount) || completedDebriefCount <= 0) {
    return 0;
  }
  return (
    Math.floor(completedDebriefCount / REP_CONSOLIDATION_INTERVAL) *
    REP_CONSOLIDATION_INTERVAL
  );
}

/** Read a rep's summary row (null if none yet). */
export async function getRepSummary(
  userId: string,
): Promise<RepSummary | null> {
  const [row] = await db
    .select()
    .from(repSummaries)
    .where(eq(repSummaries.userId, userId))
    .limit(1);
  return row ?? null;
}

/**
 * Count a rep's COMPLETED debriefs — across ALL their accounts (the rep profile is
 * cross-account). This count drives the every-10 cadence: when its threshold exceeds the
 * threshold the profile was last built at, there's a new interval to consolidate.
 */
export async function countCompletedDebriefsForRep(
  userId: string,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(callDebriefs)
    .where(
      and(
        eq(callDebriefs.userId, userId),
        eq(callDebriefs.status, "completed"),
      ),
    );
  return row?.n ?? 0;
}

/**
 * The rep's completed debriefs the consolidator reads — NEWEST FIRST, across all their
 * accounts, bounded by `limit` (the prompt-size cap). Joins the account name (cross-
 * account pattern context). Returns the distilled Phase 20 structured output (not the
 * raw report); the runner assigns the "D1"/"D2" labels. jsonb arrays are coerced
 * defensively (the same `?? []` the debrief page uses).
 *
 * INVARIANT (must stay true): the innerJoin to account_records keeps this read in
 * lockstep with countCompletedDebriefsForRep / findRepsNeedingConsolidation (which do NOT
 * join) ONLY because account_records is soft-deleted (deletedAt), never hard-deleted, and
 * call_debriefs.account_id FK cascades. So the account row always exists for every
 * completed debrief the counts see, and the join drops nothing. If a hard delete of
 * account_records is ever introduced (or the cascade removed), this read could return
 * fewer rows than the count — skewing truncatedOlderCount + the labels — so revisit then.
 */
export async function getCompletedDebriefsForRepConsolidation(
  userId: string,
  limit: number,
): Promise<Omit<RepDebriefDigest, "label">[]> {
  const rows = await db
    .select({
      debriefId: callDebriefs.id,
      occurredAt: callDebriefs.completedAt,
      createdAt: callDebriefs.createdAt,
      accountName: accountsTbl.name,
      recap: callDebriefs.recap,
      observations: callDebriefs.observations,
      commitments: callDebriefs.commitments,
      openQuestions: callDebriefs.openQuestions,
      summary: callDebriefs.summary,
    })
    .from(callDebriefs)
    .innerJoin(accountsTbl, eq(accountsTbl.id, callDebriefs.accountId))
    .where(
      and(
        eq(callDebriefs.userId, userId),
        eq(callDebriefs.status, "completed"),
      ),
    )
    // NULLS LAST so a (defensively-possible) completed debrief with a null completedAt
    // can't sort to the top and be mistaken for the newest call.
    .orderBy(
      sql`${callDebriefs.completedAt} DESC NULLS LAST`,
      desc(callDebriefs.createdAt),
    )
    .limit(limit);

  return rows.map((r) => ({
    debriefId: r.debriefId,
    // completedAt is set when a debrief completes, but fall back to createdAt defensively.
    occurredAt: r.occurredAt ?? r.createdAt,
    accountName: r.accountName ?? "an account",
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
): { note: string; lens: RepDebriefDigest["observations"][number]["lens"] }[] {
  if (!Array.isArray(v)) return [];
  const out: { note: string; lens: RepDebriefDigest["observations"][number]["lens"] }[] =
    [];
  for (const item of v) {
    const o = (item ?? {}) as Record<string, unknown>;
    const note = typeof o.note === "string" ? o.note.trim() : "";
    if (!note) continue;
    // The lens is already a validated ObservationLens (Phase 20 normalized it before
    // storing) and is only model-input context here, not stored output — keep the stored
    // string; if it's missing, default to "general".
    const lensRaw = typeof o.lens === "string" ? o.lens : "general";
    out.push({
      note,
      lens: lensRaw as RepDebriefDigest["observations"][number]["lens"],
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
 * Claim a rep's summary row for processing, idempotently. Inserts the row if absent.
 * Compare-and-swap on (status, startedAt) closes the SELECT-then-UPDATE race between the
 * debrief trigger and the cron.
 *
 * `threshold` is the every-10 high-water the consolidation is being run FOR (computed by
 * the caller via repConsolidationThreshold). When it exceeds the threshold the row was
 * last built at, this is a NEW interval → the claim resets attempts to 1 (a fresh
 * interval always gets a clean shot). Otherwise it's a retry of the same interval →
 * attempts increments and the cap applies. Caller must ensure threshold > 0 (a rep below
 * the first interval is never claimed).
 */
export async function claimRepConsolidation(
  userId: string,
  threshold: number,
  nowMs = Date.now(),
): Promise<ClaimResult> {
  await db
    .insert(repSummaries)
    .values({ userId, status: "pending" })
    .onConflictDoNothing({ target: repSummaries.userId });

  const [row] = await db
    .select()
    .from(repSummaries)
    .where(eq(repSummaries.userId, userId))
    .limit(1);

  if (!row) {
    throw new Error("Failed to create rep summary row.");
  }

  const isNewMaterial = threshold > row.debriefCount;

  // Already reflects the latest interval — nothing to do.
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
  // Same interval that has burned through its retry budget — stop (bounded loss).
  if (!isNewMaterial && row.attempts >= MAX_REP_CONSOLIDATION_ATTEMPTS) {
    return { claimed: false, reason: "exhausted", summaryId: row.id };
  }

  const nextAttempts = isNewMaterial ? 1 : row.attempts + 1;

  const claimed = await db
    .update(repSummaries)
    .set({
      status: "processing",
      startedAt: new Date(nowMs),
      attempts: nextAttempts,
      error: null,
      updatedAt: new Date(nowMs),
    })
    .where(
      and(
        eq(repSummaries.id, row.id),
        eq(repSummaries.status, row.status),
        row.startedAt
          ? eq(repSummaries.startedAt, row.startedAt)
          : isNull(repSummaries.startedAt),
      ),
    )
    .returning({ id: repSummaries.id });

  if (claimed.length === 0) {
    return { claimed: false, reason: "in-progress", summaryId: row.id };
  }
  return { claimed: true, summaryId: row.id };
}

export interface FinishRepConsolidationInput {
  headline: string;
  narrative: string;
  /** Traits with REAL debrief ids (the runner has already mapped labels → ids). */
  traits: RepTrait[];
  /** The every-10 threshold this profile reflects (the new-material high-water mark). */
  debriefCount: number;
  /** The completedAt of the newest debrief included (provenance / display). */
  consolidatedThroughAt: Date | null;
}

/**
 * Persist a completed rep consolidation. The rep profile is rep-private and not mirrored
 * anywhere shared (unlike the account summary's write-back to account_records.summary),
 * so this is a single row update — no db.batch, no write-back.
 */
export async function finishRepConsolidation(
  summaryId: string,
  input: FinishRepConsolidationInput,
): Promise<void> {
  const now = new Date();
  await db
    .update(repSummaries)
    .set({
      status: "completed",
      headline: input.headline,
      narrative: input.narrative,
      traits: input.traits,
      debriefCount: input.debriefCount,
      consolidatedThroughAt: input.consolidatedThroughAt,
      error: null,
      completedAt: now,
      updatedAt: now,
    })
    .where(eq(repSummaries.id, summaryId));
}

/** Mark a rep consolidation failed (the run threw before producing a result). */
export async function failRepConsolidation(
  summaryId: string,
  message: string,
): Promise<void> {
  await db
    .update(repSummaries)
    .set({
      status: "failed",
      error: message.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(eq(repSummaries.id, summaryId));
}

/** The summary fields the eligibility decision needs (null when no summary row yet). */
export interface EligibilitySummary {
  status: string;
  attempts: number;
  debriefCount: number;
  startedAt: Date | null;
}

/**
 * The single source of the "should this rep be (re)consolidated?" decision — pure, so
 * it's unit-tested directly. Used to filter the cron work list; claimRepConsolidation is
 * the final idempotent arbiter (mirrors the account consolidator's eligibility/claim
 * split). A rep qualifies when their completed-debrief count has reached a NEW multiple
 * of the interval (threshold > the profile's recorded threshold) AND one of: never
 * consolidated · the new threshold · a pending/failed retry under the cap · a stale
 * processing claim (a dead run). A rep below the first interval, or a profile that is
 * completed-and-current or processing by a FRESH run, is excluded. `isNewMaterial` is
 * surfaced because a new threshold resets the attempts budget at claim time.
 */
export function repConsolidationEligibility(
  summary: EligibilitySummary | null,
  completedDebriefCount: number,
  nowMs = Date.now(),
): { eligible: boolean; isNewMaterial: boolean; threshold: number } {
  // Mirrors claimRepConsolidation's branch order EXACTLY so the work list never surfaces
  // a rep the claim would then refuse (which would waste a bounded sweep slot).
  const threshold = repConsolidationThreshold(completedDebriefCount);
  // Below the first interval → no learned profile yet.
  if (threshold <= 0) return { eligible: false, isNewMaterial: false, threshold };
  if (!summary) return { eligible: true, isNewMaterial: true, threshold };

  const isNewMaterial = threshold > summary.debriefCount;

  // Already reflects the latest interval.
  if (summary.status === "completed" && !isNewMaterial) {
    return { eligible: false, isNewMaterial, threshold };
  }
  // A fresh run is in flight — let it finish.
  const startedMs = summary.startedAt ? summary.startedAt.getTime() : 0;
  const staleProcessing =
    summary.status === "processing" &&
    nowMs - startedMs >= STALE_PROCESSING_MS;
  if (summary.status === "processing" && !staleProcessing) {
    return { eligible: false, isNewMaterial, threshold };
  }
  // Same interval that has burned through its retry budget — bounded loss. Covers
  // pending/failed AND a stale-processing row at the cap (claim → 'exhausted').
  if (!isNewMaterial && summary.attempts >= MAX_REP_CONSOLIDATION_ATTEMPTS) {
    return { eligible: false, isNewMaterial, threshold };
  }
  // A new interval (claim resets attempts), an under-cap retry, or a stale reclaim.
  return { eligible: true, isNewMaterial, threshold };
}

/**
 * Reps that need (re)consolidation — the cron sweeper's work list. Computed from two
 * simple query-builder reads (no raw SQL, no correlated subquery — sidesteps the Drizzle
 * bare-column gotcha): the per-rep completed-debrief counts and the summary rows. The
 * pure `repConsolidationEligibility` decides; claimRepConsolidation is the final arbiter.
 * Bounded by `limit`, most-completed-debriefs first.
 */
export async function findRepsNeedingConsolidation(
  limit = 5,
  nowMs = Date.now(),
): Promise<string[]> {
  const counts = await db
    .select({
      userId: callDebriefs.userId,
      n: sql<number>`count(*)::int`,
    })
    .from(callDebriefs)
    .where(eq(callDebriefs.status, "completed"))
    .groupBy(callDebriefs.userId);

  if (counts.length === 0) return [];

  // Only reps who have actually reached the first interval can need consolidation, so
  // scope the summary read to the reps with enough completed debriefs (bounded) rather
  // than scanning the whole table.
  const candidateIds = counts
    .filter((c) => repConsolidationThreshold(c.n) > 0)
    .map((c) => c.userId);
  if (candidateIds.length === 0) return [];

  const summaryRows = await db
    .select({
      userId: repSummaries.userId,
      status: repSummaries.status,
      attempts: repSummaries.attempts,
      debriefCount: repSummaries.debriefCount,
      startedAt: repSummaries.startedAt,
    })
    .from(repSummaries)
    .where(inArray(repSummaries.userId, candidateIds));
  const byRep = new Map(summaryRows.map((r) => [r.userId, r]));

  const eligible = counts
    .filter((c) => {
      const summary = byRep.get(c.userId) ?? null;
      return repConsolidationEligibility(summary, c.n, nowMs).eligible;
    })
    // Most-active reps first (deterministic, by id as the tiebreak).
    .sort((a, b) => b.n - a.n || a.userId.localeCompare(b.userId))
    .slice(0, limit)
    .map((c) => c.userId);

  return eligible;
}
