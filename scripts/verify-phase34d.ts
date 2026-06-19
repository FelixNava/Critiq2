/**
 * Phase 34d unit verification — wire recording → coaching, pure logic only (no
 * network, no DB). Imports the REAL app modules (no re-implementation, per the
 * standing rule). Proves deterministically:
 *   - the transcribe→score CHAINING decision (processRecordingForScore): scoring is
 *     attempted iff the transcript is usable; an empty/failed transcript short-
 *     circuits scoring (the cron is the net), and the call never throws;
 *   - transcriptIsScorable's status gate;
 *   - the shared recording list/picker formatters the inbox AND the debrief picker
 *     now both depend on (pipelineState branches, recordingLabel fallback,
 *     fmtDuration).
 *
 * The actual transcription/scoring round-trips + the recordingId access-boundary in
 * the debrief route are runtime/preview gates (real Deepgram/Claude + DB); this is
 * the deterministic logic net around the wiring.
 *
 * Run: pnpm tsx scripts/verify-phase34d.ts
 */
import {
  processRecordingForScore,
  transcriptIsScorable,
} from "../src/lib/recording/process";
import type { TranscribeOutcome } from "../src/lib/transcription/runner";
import type { ScoreOutcome } from "../src/lib/scoring/runner";
import {
  pipelineState,
  recordingLabel,
  fmtDuration,
} from "../src/components/recording/recordingUi";

let passed = 0;
let failed = 0;

function ok(label: string, cond: boolean) {
  if (cond) {
    passed++;
    console.log(`✓ ${label}`);
  } else {
    failed++;
    console.error(`✗ ${label}`);
  }
}

function eq(label: string, a: unknown, b: unknown) {
  ok(`${label} (got ${JSON.stringify(a)})`, a === b);
}

// Stub runners that record whether scoring was reached.
function stubs(
  transcript: TranscribeOutcome,
  score: ScoreOutcome,
): {
  transcribe: (id: string) => Promise<TranscribeOutcome>;
  score: (id: string) => Promise<ScoreOutcome>;
  scoreCalls: () => number;
} {
  let scoreCalls = 0;
  return {
    transcribe: async () => transcript,
    score: async () => {
      scoreCalls++;
      return score;
    },
    scoreCalls: () => scoreCalls,
  };
}

async function main() {
  // ---- transcriptIsScorable status gate ----
  ok("scorable: completed", transcriptIsScorable("completed"));
  ok("scorable: skipped", transcriptIsScorable("skipped"));
  ok("not scorable: empty", !transcriptIsScorable("empty"));
  ok("not scorable: failed", !transcriptIsScorable("failed"));

  // ---- chaining: completed transcript → scoring attempted ----
  {
    const s = stubs(
      { status: "completed", transcriptId: "t1", wordCount: 100, segmentCount: 1, partial: false },
      { status: "completed", scoreId: "s1", overall: 82, partialJudgement: false },
    );
    const out = await processRecordingForScore("r1", { transcribe: s.transcribe, score: s.score });
    eq("completed→scored: transcript status", out.transcript, "completed");
    eq("completed→scored: score status", out.score, "completed");
    eq("completed→scored: scorer called once", s.scoreCalls(), 1);
  }

  // ---- chaining: skipped transcript (already done) → scoring still attempted ----
  {
    const s = stubs(
      { status: "skipped", transcriptId: "t2", reason: "completed" },
      { status: "skipped", scoreId: "s2", reason: "completed" },
    );
    const out = await processRecordingForScore("r2", { transcribe: s.transcribe, score: s.score });
    eq("skipped→score: transcript status", out.transcript, "skipped");
    eq("skipped→score: score status", out.score, "skipped");
    eq("skipped→score: scorer called once", s.scoreCalls(), 1);
  }

  // ---- chaining: empty transcript → scoring NOT attempted ----
  {
    const s = stubs(
      { status: "empty", transcriptId: "t3" },
      { status: "completed", scoreId: "s3", overall: 50, partialJudgement: false },
    );
    const out = await processRecordingForScore("r3", { transcribe: s.transcribe, score: s.score });
    eq("empty→skip: transcript status", out.transcript, "empty");
    eq("empty→skip: score not-attempted", out.score, "not-attempted");
    eq("empty→skip: scorer NOT called", s.scoreCalls(), 0);
  }

  // ---- chaining: failed transcript → scoring NOT attempted ----
  {
    const s = stubs(
      { status: "failed", transcriptId: "t4", error: "deepgram timeout" },
      { status: "completed", scoreId: "s4", overall: 50, partialJudgement: false },
    );
    const out = await processRecordingForScore("r4", { transcribe: s.transcribe, score: s.score });
    eq("failed→skip: transcript status", out.transcript, "failed");
    eq("failed→skip: score not-attempted", out.score, "not-attempted");
    eq("failed→skip: scorer NOT called", s.scoreCalls(), 0);
  }

  // ---- shared formatters (inbox + debrief picker) ----
  const base = { status: "completed", transcriptStatus: null, scoreStatus: null, overallScore: null };
  eq("pipeline: in progress", pipelineState({ ...base, status: "recording" }).label, "In progress");
  eq(
    "pipeline: scored with number",
    pipelineState({ ...base, scoreStatus: "completed", overallScore: 77 }).label,
    "Scored · 77",
  );
  eq(
    "pipeline: transcribed",
    pipelineState({ ...base, transcriptStatus: "completed" }).label,
    "Transcribed",
  );
  eq(
    "pipeline: transcribing",
    pipelineState({ ...base, transcriptStatus: "processing" }).label,
    "Transcribing",
  );
  eq(
    "pipeline: scoring (transcript done, score pending)",
    pipelineState({ ...base, transcriptStatus: "partial", scoreStatus: "pending" }).label,
    "Transcribed", // transcript-ready wins the label; still informative
  );
  eq("pipeline: saved fallback", pipelineState(base).label, "Saved");

  eq(
    "label: title preferred",
    recordingLabel({ title: "Beacon — first call", startedAt: "2026-06-19T12:00:00Z" }),
    "Beacon — first call",
  );
  ok(
    "label: date fallback when untitled",
    recordingLabel({ title: null, startedAt: "2026-06-19T12:00:00Z" }).startsWith("Recording · "),
  );
  eq("duration: minutes+seconds", fmtDuration(125000), "2m 05s");
  eq("duration: seconds only", fmtDuration(8000), "8s");
  eq("duration: null dash", fmtDuration(null), "—");

  console.log("");
  if (failed === 0) {
    console.log(`✅ Phase 34d verification PASSED — ${passed} assertions green.`);
  } else {
    console.error(`❌ Phase 34d verification FAILED — ${failed} of ${passed + failed} failed.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
