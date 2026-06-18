/**
 * Transcription data layer (Phase 15). Thin typed helpers over the
 * recording_transcripts + transcript_segments tables, mirroring src/lib/
 * recordings.ts. The transcript row is UNIQUE per recording, so claiming it for
 * processing is idempotent — a concurrent trigger + cron can't double-transcribe.
 */

import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "@/db";
import {
  recordings,
  recordingChunks,
  recordingTranscripts,
  transcriptSegments,
  type RecordingTranscript,
  type TranscriptSegment,
} from "@/db/schema";
import type { ChunkRef, SegmentResult, TranscriptionResult } from "./types";

/** A processing claim older than this is considered stale (a dead run) and reclaimable. */
export const STALE_PROCESSING_MS = 15 * 60 * 1000; // 15 min

/** Chunk references for a recording, in chunk order. */
export async function getChunkRefsForRecording(
  recordingId: string,
): Promise<ChunkRef[]> {
  const rows = await db
    .select({
      chunkIndex: recordingChunks.chunkIndex,
      segmentIndex: recordingChunks.segmentIndex,
      blobUrl: recordingChunks.blobUrl,
      durationMs: recordingChunks.durationMs,
      status: recordingChunks.status,
    })
    .from(recordingChunks)
    .where(eq(recordingChunks.recordingId, recordingId))
    .orderBy(recordingChunks.chunkIndex);
  return rows
    .filter((r) => r.status === "uploaded")
    .map((r) => ({
      chunkIndex: r.chunkIndex,
      segmentIndex: r.segmentIndex,
      blobUrl: r.blobUrl,
      durationMs: r.durationMs,
    }));
}

export interface TranscriptWithSegments {
  transcript: RecordingTranscript;
  segments: TranscriptSegment[];
}

/** Read a recording's transcript + its per-segment rows (null if none). */
export async function getTranscriptForRecording(
  recordingId: string,
): Promise<TranscriptWithSegments | null> {
  const [transcript] = await db
    .select()
    .from(recordingTranscripts)
    .where(eq(recordingTranscripts.recordingId, recordingId))
    .limit(1);
  if (!transcript) return null;
  const segments = await db
    .select()
    .from(transcriptSegments)
    .where(eq(transcriptSegments.transcriptId, transcript.id))
    .orderBy(transcriptSegments.segmentIndex);
  return { transcript, segments };
}

export type ClaimResult =
  | { claimed: true; transcriptId: string }
  | { claimed: false; reason: "completed" | "in-progress"; transcriptId: string };

/**
 * Claim a recording's transcript row for processing, idempotently. Inserts the
 * row if absent; if it exists, only (re)claims it when it's pending/failed or a
 * stale processing claim. Returns claimed:false for an already-completed or a
 * freshly in-progress transcript so the caller skips the work.
 */
export async function claimTranscript(
  recordingId: string,
  nowMs = Date.now(),
): Promise<ClaimResult> {
  // Ensure a row exists (idempotent on the unique recording_id).
  await db
    .insert(recordingTranscripts)
    .values({ recordingId, status: "pending" })
    .onConflictDoNothing({ target: recordingTranscripts.recordingId });

  const [row] = await db
    .select()
    .from(recordingTranscripts)
    .where(eq(recordingTranscripts.recordingId, recordingId))
    .limit(1);

  if (!row) {
    // Should not happen (we just upserted), but stay defensive.
    throw new Error("Failed to create transcript row.");
  }

  if (row.status === "completed") {
    return { claimed: false, reason: "completed", transcriptId: row.id };
  }
  if (row.status === "processing") {
    const startedMs = row.startedAt ? row.startedAt.getTime() : 0;
    if (nowMs - startedMs < STALE_PROCESSING_MS) {
      return { claimed: false, reason: "in-progress", transcriptId: row.id };
    }
    // else: stale claim — fall through and re-claim.
  }

  await db
    .update(recordingTranscripts)
    .set({
      status: "processing",
      startedAt: new Date(nowMs),
      error: null,
      updatedAt: new Date(nowMs),
    })
    .where(eq(recordingTranscripts.id, row.id));

  return { claimed: true, transcriptId: row.id };
}

/** Upsert one segment's transcript (idempotent on transcript_id + segment_index). */
export async function saveSegment(
  transcriptId: string,
  recordingId: string,
  seg: SegmentResult,
): Promise<void> {
  const values = {
    transcriptId,
    recordingId,
    segmentIndex: seg.segmentIndex,
    status: seg.error ? "failed" : "completed",
    text: seg.text || null,
    words: seg.words.length > 0 ? seg.words : null,
    confidence: seg.confidence || null,
    durationMs: seg.durationMs,
    chunkCount: seg.chunkCount,
    error: seg.error ?? null,
    updatedAt: new Date(),
  };
  await db
    .insert(transcriptSegments)
    .values(values)
    .onConflictDoUpdate({
      target: [transcriptSegments.transcriptId, transcriptSegments.segmentIndex],
      set: {
        status: values.status,
        text: values.text,
        words: values.words,
        confidence: values.confidence,
        durationMs: values.durationMs,
        chunkCount: values.chunkCount,
        error: values.error,
        updatedAt: values.updatedAt,
      },
    });
}

/** Mark the transcript completed with the unified result. */
export async function finishTranscript(
  transcriptId: string,
  result: TranscriptionResult,
): Promise<void> {
  await db
    .update(recordingTranscripts)
    .set({
      // A fully-empty transcript across all segments still "completed" (silent
      // recording) — partial only flags segment-level failures.
      status: result.partial ? "failed" : "completed",
      text: result.text,
      wordCount: result.wordCount,
      durationMs: result.durationMs,
      segmentCount: result.segmentCount,
      language: result.language ?? null,
      error: result.partial
        ? `${result.segments.filter((s) => s.error).length} segment(s) failed`
        : null,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(recordingTranscripts.id, transcriptId));
}

/** Mark the transcript failed (the whole run threw before producing a result). */
export async function failTranscript(
  transcriptId: string,
  message: string,
): Promise<void> {
  await db
    .update(recordingTranscripts)
    .set({
      status: "failed",
      error: message.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(eq(recordingTranscripts.id, transcriptId));
}

/**
 * Completed recordings with no transcript yet (or a failed/stale one) — the cron
 * sweeper's work list. Excludes soft-deleted recordings. Bounded by `limit`.
 */
export async function findRecordingsNeedingTranscription(
  limit = 5,
  nowMs = Date.now(),
): Promise<string[]> {
  const staleBefore = new Date(nowMs - STALE_PROCESSING_MS);
  const rows = await db
    .select({ id: recordings.id })
    .from(recordings)
    .leftJoin(
      recordingTranscripts,
      eq(recordingTranscripts.recordingId, recordings.id),
    )
    .where(
      and(
        eq(recordings.status, "completed"),
        isNull(recordings.deletedAt),
        or(
          isNull(recordingTranscripts.id),
          eq(recordingTranscripts.status, "pending"),
          eq(recordingTranscripts.status, "failed"),
          and(
            eq(recordingTranscripts.status, "processing"),
            lt(recordingTranscripts.startedAt, staleBefore),
          ),
        ),
      ),
    )
    .orderBy(recordings.endedAt)
    .limit(limit);
  return rows.map((r) => r.id);
}
