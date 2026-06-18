/**
 * Pre-call brief data layer (Phase 18). Thin typed helpers over the
 * pre_call_briefs table. A brief is generated synchronously inside the rep's
 * request (the rep is waiting), so — unlike the transcript/score sweepers — there
 * is no cron, no CAS claim, and no stale-reclaim: each prep is a fresh row.
 *
 * Ownership is the access boundary on read/update (the rep owns their brief). The
 * interaction COUNT, though, spans all reps on the account, because account
 * intelligence is shared (the objective handoff is about Critiq's knowledge of the
 * account, not of the rep).
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { preCallBriefs, type PreCallBrief } from "@/db/schema";
import type { ObjectiveMode } from "./objective";
import type { BriefResult } from "./types";

/**
 * How many completed interactions an account already has — the count that drives
 * the objective handoff rule. Counts COMPLETED briefs across all reps on the
 * account (shared intelligence); a failed/in-progress generation doesn't bump it.
 *
 * NOTE (flagged): a completed brief is a PROXY for an interaction until the
 * debrief/recording-to-account linkage (Phase 20+) gives a true call count. The
 * count is read here so a later phase can swap the source without touching callers.
 */
export async function getAccountInteractionCount(
  accountId: string,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(preCallBriefs)
    .where(
      and(
        eq(preCallBriefs.accountId, accountId),
        eq(preCallBriefs.status, "completed"),
      ),
    );
  return row?.n ?? 0;
}

export interface CreateBriefInput {
  accountId: string;
  userId: string;
  interactionNumber: number;
  narration: string;
  objectiveMode: ObjectiveMode;
  /** The rep's stated objective (interactions 1–2). Null on signal mode. */
  repObjective: string | null;
}

/**
 * Create the brief row already in `processing` (the AI call runs right after, in
 * the same request). Stores the input + the initial objective state; the AI output
 * + final objective land via finishBrief.
 */
export async function createBrief(
  input: CreateBriefInput,
  nowMs = Date.now(),
): Promise<string> {
  const [row] = await db
    .insert(preCallBriefs)
    .values({
      accountId: input.accountId,
      userId: input.userId,
      interactionNumber: input.interactionNumber,
      narration: input.narration,
      objectiveSource: input.objectiveMode === "signal" ? "signal" : "rep",
      objective: input.objectiveMode === "rep" ? input.repObjective : null,
      status: "processing",
      attempts: 1,
      startedAt: new Date(nowMs),
    })
    .returning({ id: preCallBriefs.id });
  return row.id;
}

/**
 * Persist a completed brief. On signal mode, the model's recommendation becomes
 * the in-force objective (accepted by default; the rep can override via PATCH). On
 * rep mode, the rep's objective stays in force and the recommendation is null.
 */
export async function finishBrief(
  briefId: string,
  mode: ObjectiveMode,
  result: BriefResult,
): Promise<void> {
  const recommended =
    mode === "signal" ? result.recommendedObjective : null;
  await db
    .update(preCallBriefs)
    .set({
      status: "completed",
      diagnosis: result.diagnosis,
      approach: result.approach,
      objections: result.objections,
      summary: result.summary,
      recommendedObjective: recommended,
      // On signal mode, default the in-force objective to the recommendation.
      ...(mode === "signal" ? { objective: recommended } : {}),
      error: null,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(preCallBriefs.id, briefId));
}

/** Mark a brief failed (the generation threw). */
export async function failBrief(
  briefId: string,
  message: string,
): Promise<void> {
  await db
    .update(preCallBriefs)
    .set({
      status: "failed",
      error: message.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(eq(preCallBriefs.id, briefId));
}

/** A brief owned by the rep (ownership = access boundary). Null if not theirs. */
export async function getBriefForUser(
  userId: string,
  briefId: string,
): Promise<PreCallBrief | null> {
  const [row] = await db
    .select()
    .from(preCallBriefs)
    .where(and(eq(preCallBriefs.id, briefId), eq(preCallBriefs.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** The rep's most recent brief for an account (for the page's "last prep" view). */
export async function getLatestBriefForAccount(
  userId: string,
  accountId: string,
): Promise<PreCallBrief | null> {
  const [row] = await db
    .select()
    .from(preCallBriefs)
    .where(
      and(
        eq(preCallBriefs.userId, userId),
        eq(preCallBriefs.accountId, accountId),
      ),
    )
    .orderBy(desc(preCallBriefs.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * Set the in-force objective on a brief the rep owns. When it differs from
 * Critiq's recommendation it's an override: objectiveSource flips to 'rep' and
 * `overridden` is recorded (the deviation the learning loop cares about). Returns
 * the updated row, or null if the brief isn't the rep's.
 */
export async function setBriefObjective(
  userId: string,
  briefId: string,
  objective: string,
): Promise<PreCallBrief | null> {
  const existing = await getBriefForUser(userId, briefId);
  if (!existing) return null;
  // `overridden` reflects whether the in-force objective CURRENTLY differs from
  // Critiq's recommendation — not sticky. Editing back to the recommendation
  // verbatim clears it, so the learning loop never reads a false deviation.
  const isOverride =
    existing.recommendedObjective != null &&
    objective.trim() !== existing.recommendedObjective.trim();
  const [row] = await db
    .update(preCallBriefs)
    .set({
      objective: objective.trim(),
      objectiveSource: "rep",
      overridden: isOverride,
      updatedAt: new Date(),
    })
    .where(eq(preCallBriefs.id, briefId))
    .returning();
  return row ?? null;
}

/** Set the rep's 1–5 usefulness rating on a brief they own. */
export async function setBriefRating(
  userId: string,
  briefId: string,
  rating: number,
): Promise<PreCallBrief | null> {
  const existing = await getBriefForUser(userId, briefId);
  if (!existing) return null;
  const [row] = await db
    .update(preCallBriefs)
    .set({ usefulnessRating: rating, updatedAt: new Date() })
    .where(eq(preCallBriefs.id, briefId))
    .returning();
  return row ?? null;
}
