/**
 * Transcription runner (Phase 15) — ties the pure orchestration (transcribe.ts)
 * to the DB store + the real Deepgram client + the Blob fetcher. Used by both the
 * authenticated trigger route and the cron sweeper, so the claim/process/persist
 * lifecycle lives in exactly one place.
 *
 * Lifecycle: claim the transcript row (idempotent — skips an already-completed or
 * freshly-in-progress one), transcribe each segment in parallel, persist each
 * segment as it lands, then finalize the unified transcript. Any throw before a
 * result marks the row failed (and the cron will retry it on the next sweep).
 */

import { DeepgramTranscriber } from "./deepgram";
import { blobChunkFetcher } from "./blobFetcher";
import { transcribeRecording } from "./transcribe";
import {
  claimTranscript,
  failTranscript,
  finishTranscript,
  getChunkRefsForRecording,
  saveSegment,
} from "./store";
import type { ChunkFetcher, Transcriber } from "./types";

export type TranscribeOutcome =
  | { status: "completed"; transcriptId: string; wordCount: number; segmentCount: number; partial: boolean }
  | { status: "skipped"; transcriptId: string; reason: "completed" | "in-progress" }
  | { status: "empty"; transcriptId: string } // completed but no chunks/uploaded audio
  | { status: "failed"; transcriptId: string; error: string };

export interface RunnerDeps {
  transcriber?: Transcriber;
  fetchChunk?: ChunkFetcher["fetchChunk"];
  nowMs?: number;
}

/**
 * Transcribe one recording end-to-end. Caller must have already authorized
 * access to the recording (ownership or cron secret).
 */
export async function runTranscriptionForRecording(
  recordingId: string,
  deps: RunnerDeps = {},
): Promise<TranscribeOutcome> {
  const claim = await claimTranscript(recordingId, deps.nowMs);
  if (!claim.claimed) {
    return { status: "skipped", transcriptId: claim.transcriptId, reason: claim.reason };
  }
  const transcriptId = claim.transcriptId;

  try {
    const chunks = await getChunkRefsForRecording(recordingId);
    if (chunks.length === 0) {
      // Nothing uploaded — mark completed-empty so the cron stops re-picking it.
      await finishTranscript(transcriptId, {
        text: "",
        segments: [],
        wordCount: 0,
        durationMs: null,
        segmentCount: 0,
        partial: false,
      });
      return { status: "empty", transcriptId };
    }

    const transcriber = deps.transcriber ?? new DeepgramTranscriber();
    const fetchChunk = deps.fetchChunk ?? blobChunkFetcher.fetchChunk;

    const result = await transcribeRecording(chunks, {
      transcriber,
      fetchChunk,
      onSegment: (seg) => saveSegment(transcriptId, recordingId, seg),
    });

    await finishTranscript(transcriptId, result);
    return {
      status: "completed",
      transcriptId,
      wordCount: result.wordCount,
      segmentCount: result.segmentCount,
      partial: result.partial,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await failTranscript(transcriptId, message);
    return { status: "failed", transcriptId, error: message };
  }
}
