/**
 * Post-call debrief data layer (Phase 20). Thin typed helpers over the call_debriefs
 * table. A debrief is generated synchronously inside the rep's request (the rep is
 * waiting), so — like the brief/script — there is no cron, no CAS claim, and no
 * stale-reclaim: each debrief is a fresh row.
 *
 * Ownership is the access boundary on read/update (the rep owns their debrief). The
 * raw guided `report` is stored verbatim (the episodic source of truth) alongside
 * the AI's structured output.
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { callDebriefs, type CallDebrief } from "@/db/schema";
import type { DebriefReport, DebriefResult } from "./types";

export interface CreateDebriefInput {
  accountId: string;
  userId: string;
  report: DebriefReport;
  /** Optional links closing the loop (not wired in the Phase 20 UI). */
  recordingId?: string | null;
  briefId?: string | null;
}

/**
 * Create the debrief row already in `processing` (the AI call runs right after, in
 * the same request). Stores the raw report; the structured output lands via
 * finishDebrief.
 */
export async function createDebrief(
  input: CreateDebriefInput,
  nowMs = Date.now(),
): Promise<string> {
  const [row] = await db
    .insert(callDebriefs)
    .values({
      accountId: input.accountId,
      userId: input.userId,
      recordingId: input.recordingId ?? null,
      briefId: input.briefId ?? null,
      report: input.report,
      status: "processing",
      attempts: 1,
      startedAt: new Date(nowMs),
    })
    .returning({ id: callDebriefs.id });
  return row.id;
}

/** Persist a completed debrief (the AI's structured output). */
export async function finishDebrief(
  debriefId: string,
  result: DebriefResult,
): Promise<void> {
  await db
    .update(callDebriefs)
    .set({
      status: "completed",
      recap: result.recap,
      observations: result.observations,
      commitments: result.commitments,
      openQuestions: result.openQuestions,
      summary: result.summary,
      error: null,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(callDebriefs.id, debriefId));
}

/** Mark a debrief failed (the generation threw). */
export async function failDebrief(
  debriefId: string,
  message: string,
): Promise<void> {
  await db
    .update(callDebriefs)
    .set({
      status: "failed",
      error: message.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(eq(callDebriefs.id, debriefId));
}

/** A debrief owned by the rep (ownership = access boundary). Null if not theirs. */
export async function getDebriefForUser(
  userId: string,
  debriefId: string,
): Promise<CallDebrief | null> {
  const [row] = await db
    .select()
    .from(callDebriefs)
    .where(
      and(eq(callDebriefs.id, debriefId), eq(callDebriefs.userId, userId)),
    )
    .limit(1);
  return row ?? null;
}

/**
 * The rep's most recent COMPLETED debrief for an account (for the page's "last
 * debrief" view). Filtering to completed means a failed/in-flight row can't bury the
 * last good debrief (the same guard the script store applies).
 */
export async function getLatestDebriefForAccount(
  userId: string,
  accountId: string,
): Promise<CallDebrief | null> {
  const [row] = await db
    .select()
    .from(callDebriefs)
    .where(
      and(
        eq(callDebriefs.userId, userId),
        eq(callDebriefs.accountId, accountId),
        eq(callDebriefs.status, "completed"),
      ),
    )
    .orderBy(desc(callDebriefs.createdAt))
    .limit(1);
  return row ?? null;
}

/** All of the rep's completed debriefs for an account, newest first (history list). */
export async function listDebriefsForAccount(
  userId: string,
  accountId: string,
): Promise<CallDebrief[]> {
  return db
    .select()
    .from(callDebriefs)
    .where(
      and(
        eq(callDebriefs.userId, userId),
        eq(callDebriefs.accountId, accountId),
        eq(callDebriefs.status, "completed"),
      ),
    )
    .orderBy(desc(callDebriefs.createdAt));
}

/**
 * Set the rep's 1–5 usefulness rating on a debrief they own. The UPDATE is scoped
 * to (id, userId) so the helper enforces ownership in a single statement — correct
 * in isolation, not just behind the route's pre-check.
 */
export async function setDebriefRating(
  userId: string,
  debriefId: string,
  rating: number,
): Promise<CallDebrief | null> {
  const [row] = await db
    .update(callDebriefs)
    .set({ usefulnessRating: rating, updatedAt: new Date() })
    .where(
      and(eq(callDebriefs.id, debriefId), eq(callDebriefs.userId, userId)),
    )
    .returning();
  return row ?? null;
}
