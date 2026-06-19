/**
 * Recording → score pipeline (Phase 34d). Chains the two built, idempotent runners
 * — transcription (Phase 15) then scoring (Phase 16) — into a single call so a
 * recently-assigned recording can be brought to a scored state ahead of the rep
 * debriefing it. This is a LATENCY optimization, not a new source of truth: both
 * runners are idempotent (claim-based), and the /api/cron/transcribe + /api/cron/score
 * sweepers remain the reliability net for anything that fails or times out here.
 *
 * Server-only (imports the DB-backed runners). The CALLER must already have
 * authorized access to the recording (ownership or cron secret).
 */

import { runTranscriptionForRecording } from "@/lib/transcription/runner";
import { runScoringForRecording } from "@/lib/scoring/runner";
import type { TranscribeOutcome } from "@/lib/transcription/runner";
import type { ScoreOutcome } from "@/lib/scoring/runner";

export type ProcessOutcome = {
  transcript: TranscribeOutcome["status"];
  // 'not-attempted' = the transcript wasn't ready/usable, so scoring wasn't run
  // (the score cron picks it up once a transcript lands).
  score: ScoreOutcome["status"] | "not-attempted";
};

/**
 * Whether a transcription outcome is worth handing to the scorer. 'completed' is
 * the obvious case; 'skipped' means another run already claimed the transcript —
 * either finished (then it's scorable now) or still in-progress (then the scorer
 * cleanly no-ops with 'no-transcript' and the score cron is the net), so trying is
 * safe and cheap. 'empty'/'failed' have nothing to score. The scoring runner
 * re-checks real scorability regardless, so this is only a cheap pre-filter. Pure +
 * exported so the chaining decision is unit-testable without a DB/network.
 */
export function transcriptIsScorable(status: TranscribeOutcome["status"]): boolean {
  return status === "completed" || status === "skipped";
}

export interface ProcessDeps {
  transcribe?: (id: string) => Promise<TranscribeOutcome>;
  score?: (id: string) => Promise<ScoreOutcome>;
}

/**
 * Transcribe a recording, then — only if a usable transcript resulted — score it.
 * Never throws: the runners catch their own errors and report a status, so a caller
 * firing this post-response (Vercel `after()`) can't crash the request. An empty or
 * failed transcript short-circuits scoring (nothing to score yet); the score sweeper
 * is the net. Deps are injectable for unit testing.
 */
export async function processRecordingForScore(
  recordingId: string,
  deps: ProcessDeps = {},
): Promise<ProcessOutcome> {
  const transcribe = deps.transcribe ?? runTranscriptionForRecording;
  const score = deps.score ?? runScoringForRecording;

  const t = await transcribe(recordingId);
  if (!transcriptIsScorable(t.status)) {
    return { transcript: t.status, score: "not-attempted" };
  }

  const s = await score(recordingId);
  return { transcript: t.status, score: s.status };
}
