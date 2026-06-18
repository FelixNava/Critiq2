/**
 * Scoring runner (Phase 16) — ties the pure engine (score.ts) to the DB store +
 * the real Claude scorer (anthropic.ts). Used by both the authenticated trigger
 * route and the cron sweeper, so the claim/score/persist lifecycle lives in
 * exactly one place. Mirrors src/lib/transcription/runner.ts.
 *
 * Lifecycle: read the recording's transcript (only completed/partial-with-text
 * is scorable) → claim the score row (idempotent — skips an already-completed or
 * freshly-in-progress one) → score via Claude → persist the bounded result. Any
 * throw before a result marks the row failed (the cron retries up to the cap).
 */

import { AnthropicScorer } from "./anthropic";
import { scoreTranscript } from "./score";
import {
  claimScore,
  failScore,
  finishScore,
  getScorableTranscript,
} from "./store";
import type { Scorer } from "./types";

export type ScoreOutcome =
  | { status: "completed"; scoreId: string; overall: number; partialJudgement: boolean }
  | { status: "skipped"; scoreId: string; reason: "completed" | "in-progress" }
  | { status: "no-transcript"; recordingId: string } // nothing scorable yet
  | { status: "failed"; scoreId: string; error: string };

export interface ScoreRunnerDeps {
  scorer?: Scorer;
  nowMs?: number;
}

/**
 * Score one recording end-to-end. Caller must have already authorized access to
 * the recording (ownership or cron secret).
 */
export async function runScoringForRecording(
  recordingId: string,
  deps: ScoreRunnerDeps = {},
): Promise<ScoreOutcome> {
  const transcript = await getScorableTranscript(recordingId);
  if (!transcript) {
    // No completed/partial transcript with text yet — nothing to score. The cron
    // (and the trigger) will pick it up once the transcript lands.
    return { status: "no-transcript", recordingId };
  }

  const claim = await claimScore(recordingId, transcript.transcriptId, deps.nowMs);
  if (!claim.claimed) {
    return { status: "skipped", scoreId: claim.scoreId, reason: claim.reason };
  }
  const scoreId = claim.scoreId;

  try {
    const scorer = deps.scorer ?? new AnthropicScorer();
    const result = await scoreTranscript(
      {
        text: transcript.text,
        status: transcript.status,
        wordCount: transcript.wordCount,
      },
      scorer,
    );
    await finishScore(scoreId, result);
    return {
      status: "completed",
      scoreId,
      overall: result.overall,
      partialJudgement: result.partialJudgement,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await failScore(scoreId, message);
    return { status: "failed", scoreId, error: message };
  }
}
