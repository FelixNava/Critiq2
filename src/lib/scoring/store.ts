/**
 * Scoring data layer (Phase 16). Thin typed helpers over the call_scores table,
 * mirroring src/lib/transcription/store.ts exactly: the score row is UNIQUE per
 * recording, so claiming it for processing is idempotent — a concurrent trigger +
 * cron can't double-score. Same CAS claim, same attempts cap, same stale-reclaim.
 */

import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  callScores,
  recordings,
  recordingTranscripts,
  type CallScore,
} from "@/db/schema";
import type { ScorableTranscript, ScoreResult } from "./types";

/** A processing claim older than this is a dead run and reclaimable. */
export const STALE_PROCESSING_MS = 15 * 60 * 1000; // 15 min

/**
 * The cron sweeper stops auto-retrying a recording once attempts hits this cap
 * (bounded loss, like the transcript sweeper's MAX_TRANSCRIPTION_ATTEMPTS). A
 * human can still re-trigger past the cap via the authenticated route.
 */
export const MAX_SCORING_ATTEMPTS = 3;

/** Read a recording's score row (null if none). */
export async function getScoreForRecording(
  recordingId: string,
): Promise<CallScore | null> {
  const [row] = await db
    .select()
    .from(callScores)
    .where(eq(callScores.recordingId, recordingId))
    .limit(1);
  return row ?? null;
}

/**
 * The transcript a recording will be scored from — only completed/partial
 * transcripts with actual text are scorable. Returns null when there's nothing
 * (yet) to score, so the runner can skip cleanly.
 */
export async function getScorableTranscript(
  recordingId: string,
): Promise<(ScorableTranscript & { transcriptId: string }) | null> {
  const [row] = await db
    .select({
      transcriptId: recordingTranscripts.id,
      text: recordingTranscripts.text,
      status: recordingTranscripts.status,
      wordCount: recordingTranscripts.wordCount,
    })
    .from(recordingTranscripts)
    .where(eq(recordingTranscripts.recordingId, recordingId))
    .limit(1);
  if (!row) return null;
  if (row.status !== "completed" && row.status !== "partial") return null;
  const text = row.text ?? "";
  if (!text.trim()) return null;
  return {
    transcriptId: row.transcriptId,
    text,
    status: row.status,
    wordCount: row.wordCount,
  };
}

export type ClaimResult =
  | { claimed: true; scoreId: string }
  | { claimed: false; reason: "completed" | "in-progress"; scoreId: string };

/**
 * Claim a recording's score row for processing, idempotently. Inserts the row if
 * absent; if it exists, only (re)claims it when it's pending/failed or a stale
 * processing claim. Compare-and-swap on (status, startedAt) closes the
 * SELECT-then-UPDATE race between the cron and the manual trigger.
 */
export async function claimScore(
  recordingId: string,
  transcriptId: string | null,
  nowMs = Date.now(),
): Promise<ClaimResult> {
  await db
    .insert(callScores)
    .values({ recordingId, transcriptId, status: "pending" })
    .onConflictDoNothing({ target: callScores.recordingId });

  const [row] = await db
    .select()
    .from(callScores)
    .where(eq(callScores.recordingId, recordingId))
    .limit(1);

  if (!row) {
    throw new Error("Failed to create score row.");
  }

  if (row.status === "completed") {
    return { claimed: false, reason: "completed", scoreId: row.id };
  }
  if (row.status === "processing") {
    const startedMs = row.startedAt ? row.startedAt.getTime() : 0;
    if (nowMs - startedMs < STALE_PROCESSING_MS) {
      return { claimed: false, reason: "in-progress", scoreId: row.id };
    }
    // else: stale claim — fall through and re-claim.
  }

  const claimed = await db
    .update(callScores)
    .set({
      status: "processing",
      // Refresh the transcript provenance in case it was created without one.
      transcriptId: transcriptId ?? row.transcriptId,
      startedAt: new Date(nowMs),
      attempts: sql`${callScores.attempts} + 1`,
      error: null,
      updatedAt: new Date(nowMs),
    })
    .where(
      and(
        eq(callScores.id, row.id),
        eq(callScores.status, row.status),
        row.startedAt
          ? eq(callScores.startedAt, row.startedAt)
          : isNull(callScores.startedAt),
      ),
    )
    .returning({ id: callScores.id });

  if (claimed.length === 0) {
    return { claimed: false, reason: "in-progress", scoreId: row.id };
  }
  return { claimed: true, scoreId: row.id };
}

/** Persist a completed score result. */
export async function finishScore(
  scoreId: string,
  result: ScoreResult,
): Promise<void> {
  // Store the per-dimension detail keyed by dimension key (rationale + evidence).
  const dimensions: Record<
    string,
    { score: number; rationale: string; evidence: string[] }
  > = {};
  for (const d of result.dimensions) {
    dimensions[d.key] = {
      score: d.score,
      rationale: d.rationale,
      evidence: d.evidence,
    };
  }
  await db
    .update(callScores)
    .set({
      status: "completed",
      overallScore: result.overall,
      spinScore: result.pillars.spin.score,
      vossScore: result.pillars.voss.score,
      navarroScore: result.pillars.navarro.score,
      dimensions,
      strengths: result.overallStrengths,
      improvements: result.overallImprovements,
      summary: result.summary,
      partialJudgement: result.partialJudgement,
      error: null,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(callScores.id, scoreId));
}

/** Mark a score failed (the run threw before producing a result). */
export async function failScore(
  scoreId: string,
  message: string,
): Promise<void> {
  await db
    .update(callScores)
    .set({
      status: "failed",
      error: message.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(eq(callScores.id, scoreId));
}

/**
 * Recordings whose transcript is ready (completed/partial) but whose score is
 * missing / pending / failed / staled-out — the cron sweeper's work list.
 * Excludes soft-deleted recordings. Bounded by `limit`.
 */
export async function findRecordingsNeedingScoring(
  limit = 5,
  nowMs = Date.now(),
): Promise<string[]> {
  const staleBefore = new Date(nowMs - STALE_PROCESSING_MS);
  const rows = await db
    .select({ id: recordings.id })
    .from(recordings)
    .innerJoin(
      recordingTranscripts,
      eq(recordingTranscripts.recordingId, recordings.id),
    )
    .leftJoin(callScores, eq(callScores.recordingId, recordings.id))
    .where(
      and(
        isNull(recordings.deletedAt),
        // Only score recordings whose transcript actually has usable text.
        or(
          eq(recordingTranscripts.status, "completed"),
          eq(recordingTranscripts.status, "partial"),
        ),
        sql`${recordingTranscripts.text} is not null and length(trim(${recordingTranscripts.text})) > 0`,
        or(
          // Never scored yet.
          isNull(callScores.id),
          // Retryable states, under the attempt cap.
          and(
            or(
              eq(callScores.status, "pending"),
              eq(callScores.status, "failed"),
            ),
            lt(callScores.attempts, MAX_SCORING_ATTEMPTS),
          ),
          // A processing claim from a run that died (stale) — reclaim it.
          and(
            eq(callScores.status, "processing"),
            lt(callScores.startedAt, staleBefore),
          ),
        ),
      ),
    )
    .orderBy(recordings.endedAt)
    .limit(limit);
  return rows.map((r) => r.id);
}
