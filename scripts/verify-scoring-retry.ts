/**
 * Scoring in-call retry verification (Phase 16 robustness fix). PURE: no network.
 * Imports the REAL AnthropicScorer (DI fake fetch + no-op sleep) and proves a
 * transient unparseable / 5xx / 429 sampling is retried before the row fails,
 * while a refusal / 4xx / a clean parse are NOT retried. This is the fix for the
 * live incident where one Opus "not valid JSON" sampling killed an assessment
 * (and the preview has no cron to retry it).
 *
 * Run: pnpm tsx scripts/verify-scoring-retry.ts
 */
import {
  AnthropicScorer,
  AnthropicScoringError,
  isRetryableScoringError,
} from "../src/lib/scoring/anthropic";
import type { ScorableTranscript } from "../src/lib/scoring/types";

process.env.ANTHROPIC_API_KEY = "test-key"; // requireApiKey() passes

const fails: string[] = [];
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) fails.push(msg);
};

const TRANSCRIPT: ScorableTranscript = { text: "hi", status: "completed", wordCount: 1 };
const VALID = JSON.stringify({
  dimensions: { situation: { score: 5, rationale: "r", evidence: ["e"] } },
  overallStrengths: ["s"],
  overallImprovements: ["i"],
  summary: "sum",
});

type FakeOpts = { status?: number; text?: string | null; stop_reason?: string; errText?: string };
const resp = (o: FakeOpts) =>
  ({
    ok: (o.status ?? 200) < 400,
    status: o.status ?? 200,
    text: async () => o.errText ?? "",
    json: async () => ({
      stop_reason: o.stop_reason ?? "end_turn",
      content: o.text != null ? [{ type: "text", text: o.text }] : [],
      usage: {},
    }),
  }) as unknown as Response;

/** A fetch that returns each queued response in order (sticks on the last). */
function seq(responses: Response[]) {
  let calls = 0;
  const fetchImpl = (async () => responses[Math.min(calls++, responses.length - 1)]) as unknown as typeof fetch;
  return { fetchImpl, calls: () => calls };
}
const noSleep = async () => {};
const badJson = resp({ text: "this is { not json" });
const valid = resp({ text: VALID });
const refusal = resp({ stop_reason: "refusal", text: null });

async function main() {
  // -------------------------------------------------------------------------
  console.log("\n## isRetryableScoringError");
  // -------------------------------------------------------------------------
  ok(isRetryableScoringError(new AnthropicScoringError("Model output was not valid JSON.")), "bad JSON (no status) → retryable");
  ok(isRetryableScoringError(new AnthropicScoringError("No text content in response (stop_reason=end_turn).")), "empty text → retryable");
  ok(isRetryableScoringError(new AnthropicScoringError("Scoring response was truncated (max_tokens).")), "truncation → retryable");
  ok(isRetryableScoringError(new AnthropicScoringError("Anthropic request failed: socket hang up")), "network failure → retryable");
  ok(isRetryableScoringError(new AnthropicScoringError("x", 429)), "429 → retryable");
  ok(isRetryableScoringError(new AnthropicScoringError("x", 503)), "503 → retryable");
  ok(!isRetryableScoringError(new AnthropicScoringError("Model refused to score this transcript.")), "refusal → NOT retryable");
  ok(!isRetryableScoringError(new AnthropicScoringError("x", 400)), "400 → NOT retryable");
  ok(!isRetryableScoringError(new AnthropicScoringError("x", 401)), "401 → NOT retryable");
  ok(!isRetryableScoringError(new Error("plain")), "a non-scoring error → NOT retryable");

  // -------------------------------------------------------------------------
  console.log("\n## AnthropicScorer retry loop");
  // -------------------------------------------------------------------------
  {
    const f = seq([badJson, valid]);
    const scorer = new AnthropicScorer({ fetchImpl: f.fetchImpl, sleep: noSleep });
    const r = await scorer.score(TRANSCRIPT);
    ok(f.calls() === 2 && r.dimensions.situation?.score === 5, "transient bad JSON then valid → succeeds on retry (2 calls)");
  }
  {
    const f = seq([resp({ status: 500, errText: "boom" }), valid]);
    const scorer = new AnthropicScorer({ fetchImpl: f.fetchImpl, sleep: noSleep });
    const r = await scorer.score(TRANSCRIPT);
    ok(f.calls() === 2 && r.summary === "sum", "500 then valid → succeeds on retry (2 calls)");
  }
  {
    const f = seq([valid]);
    const scorer = new AnthropicScorer({ fetchImpl: f.fetchImpl, sleep: noSleep });
    await scorer.score(TRANSCRIPT);
    ok(f.calls() === 1, "valid on the first try → no extra calls");
  }
  {
    const f = seq([badJson, badJson, badJson, badJson]);
    const scorer = new AnthropicScorer({ fetchImpl: f.fetchImpl, sleep: noSleep });
    let threw = "";
    try { await scorer.score(TRANSCRIPT); } catch (e) { threw = (e as Error).message; }
    ok(f.calls() === 3 && /not valid JSON/.test(threw), "persistent bad JSON → fails after maxAttempts=3 (3 calls)");
  }
  {
    const f = seq([refusal]);
    const scorer = new AnthropicScorer({ fetchImpl: f.fetchImpl, sleep: noSleep });
    let threw = "";
    try { await scorer.score(TRANSCRIPT); } catch (e) { threw = (e as Error).message; }
    ok(f.calls() === 1 && /refused/i.test(threw), "refusal → fails immediately, NOT retried (1 call)");
  }
  {
    const f = seq([resp({ status: 400, errText: "bad request" })]);
    const scorer = new AnthropicScorer({ fetchImpl: f.fetchImpl, sleep: noSleep });
    let threw = "";
    try { await scorer.score(TRANSCRIPT); } catch (e) { threw = (e as Error).message; }
    ok(f.calls() === 1 && /400/.test(threw), "4xx → fails immediately, NOT retried (1 call)");
  }
  {
    const f = seq([badJson, badJson]);
    const scorer = new AnthropicScorer({ fetchImpl: f.fetchImpl, sleep: noSleep, maxAttempts: 2 });
    let threw = "";
    try { await scorer.score(TRANSCRIPT); } catch (e) { threw = (e as Error).message; }
    ok(f.calls() === 2 && /not valid JSON/.test(threw), "maxAttempts honored (2 calls then fail)");
  }

  console.log(`\n${fails.length === 0 ? "PASS" : "FAIL"} — ${fails.length} failing`);
  if (fails.length > 0) {
    for (const x of fails) console.log(`  ✗ ${x}`);
    process.exit(1);
  }
}
main().then(() => process.exit(0));
