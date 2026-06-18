/**
 * Coaching data layer (Phase 21). Thin typed helpers over the call_coaching table.
 * Coaching is generated synchronously inside the rep's request (the rep is waiting),
 * so — like the brief/script/debrief — there is no cron, no CAS claim: each
 * generation is a fresh row. Ownership is the access boundary on read/update.
 *
 * The objective score the coaching was built against is snapshotted at create time
 * (recordingId/scoreId/scoreSnapshot) so the displayed score and the advice stay one
 * coherent artifact even if the call is re-scored later.
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { callCoaching, type CallCoaching } from "@/db/schema";
import type { CoachingResult, ScoreSnapshot } from "./types";

export interface CreateCoachingInput {
  debriefId: string;
  accountId: string;
  userId: string;
  /** Provenance of the objective half (null when the call wasn't recorded/scored). */
  recordingId?: string | null;
  scoreId?: string | null;
  scoreSnapshot?: ScoreSnapshot | null;
}

/**
 * Create the coaching row already in `processing` (the AI call runs right after, in
 * the same request). The score snapshot is stored now (it's an input); the AI output
 * lands via finishCoaching.
 */
export async function createCoaching(
  input: CreateCoachingInput,
  nowMs = Date.now(),
): Promise<string> {
  const [row] = await db
    .insert(callCoaching)
    .values({
      debriefId: input.debriefId,
      accountId: input.accountId,
      userId: input.userId,
      recordingId: input.recordingId ?? null,
      scoreId: input.scoreId ?? null,
      scoreSnapshot: input.scoreSnapshot ?? null,
      status: "processing",
      attempts: 1,
      startedAt: new Date(nowMs),
    })
    .returning({ id: callCoaching.id });
  return row.id;
}

/** Persist completed coaching (the AI's structured output). */
export async function finishCoaching(
  coachingId: string,
  result: CoachingResult,
): Promise<void> {
  await db
    .update(callCoaching)
    .set({
      status: "completed",
      priorities: result.priorities,
      reinforce: result.reinforce,
      nextStep: result.nextStep,
      summary: result.summary,
      error: null,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(callCoaching.id, coachingId));
}

/** Mark coaching failed (the generation threw). */
export async function failCoaching(
  coachingId: string,
  message: string,
): Promise<void> {
  await db
    .update(callCoaching)
    .set({
      status: "failed",
      error: message.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(eq(callCoaching.id, coachingId));
}

/** Coaching owned by the rep (ownership = access boundary). Null if not theirs. */
export async function getCoachingForUser(
  userId: string,
  coachingId: string,
): Promise<CallCoaching | null> {
  const [row] = await db
    .select()
    .from(callCoaching)
    .where(
      and(eq(callCoaching.id, coachingId), eq(callCoaching.userId, userId)),
    )
    .limit(1);
  return row ?? null;
}

/**
 * The rep's most recent COMPLETED coaching for a given debrief (the page's "latest"
 * view). Filtered to `completed` deliberately: a failed re-coach creates a newer row
 * but must NOT bury the rep's last good coaching — the latest usable coaching is what
 * the page and the GET route want (the same guard the script/debrief stores apply).
 */
export async function getLatestCoachingForDebrief(
  userId: string,
  debriefId: string,
): Promise<CallCoaching | null> {
  const [row] = await db
    .select()
    .from(callCoaching)
    .where(
      and(
        eq(callCoaching.userId, userId),
        eq(callCoaching.debriefId, debriefId),
        eq(callCoaching.status, "completed"),
      ),
    )
    .orderBy(desc(callCoaching.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * Set the rep's 1–5 usefulness rating on coaching they own. The UPDATE is scoped to
 * (id, userId) so the helper enforces ownership in a single statement — correct in
 * isolation, not just behind the route's pre-check (mirrors setDebriefRating).
 */
export async function setCoachingRating(
  userId: string,
  coachingId: string,
  rating: number,
): Promise<CallCoaching | null> {
  const [row] = await db
    .update(callCoaching)
    .set({ usefulnessRating: rating, updatedAt: new Date() })
    .where(
      and(eq(callCoaching.id, coachingId), eq(callCoaching.userId, userId)),
    )
    .returning();
  return row ?? null;
}
