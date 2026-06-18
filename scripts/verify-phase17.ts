/**
 * Phase 17 unit verification — Anthropic prompt-caching wiring. Imports the REAL
 * app modules (no re-implementation, per the standing rule) and exercises:
 *   - buildCachedSystem: breakpoint placement, empty-layer drop, multi-layer
 *     (methodology + rep intake), and the MAX_CACHE_BREAKPOINTS cap.
 *   - summarizeCacheUsage / formatCacheUsage: NaN-safe parsing of the usage object.
 *   - minCacheableTokens: per-model minimums.
 *   - The scoring request still carries the methodology cache breakpoint through
 *     the new helper (Phase 16 regression).
 *   - AnthropicScorer surfaces cache usage via onUsage, using a FAKE fetch (no
 *     network, no Anthropic call).
 *
 * The REAL Claude cache round-trip (does the hit rate actually go up across two
 * identical-prefix calls?) is verified separately by a throwaway live probe — see
 * the Phase 17 PR/decision note; the relaxed aggressive gate doesn't block on it.
 *
 * Run: pnpm tsx scripts/verify-phase17.ts
 */
import {
  EPHEMERAL_CACHE_CONTROL,
  MAX_CACHE_BREAKPOINTS,
  buildCachedSystem,
  formatCacheUsage,
  minCacheableTokens,
  summarizeCacheUsage,
} from "../src/lib/ai/cache";
import {
  AnthropicScorer,
  SCORING_MODEL,
  buildScoringRequest,
} from "../src/lib/scoring/anthropic";
import type { CacheUsageSummary } from "../src/lib/ai/cache";

const fails: string[] = [];
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) fails.push(msg);
};

async function main() {
  // ---------- buildCachedSystem ----------
  {
    const one = buildCachedSystem([{ text: "methodology block" }]);
    ok(one.length === 1, "single layer → one system block");
    ok(one[0].type === "text", "block is a text block");
    ok(
      one[0].cache_control?.type === "ephemeral",
      "single stable layer carries an ephemeral breakpoint",
    );
    ok(
      one[0].cache_control === EPHEMERAL_CACHE_CONTROL,
      "uses the shared ephemeral marker constant",
    );

    // Two stable layers (methodology + rep intake) → each its own breakpoint.
    const two = buildCachedSystem([
      { text: "methodology" },
      { text: "rep intake" },
    ]);
    ok(two.length === 2, "two layers → two system blocks (order preserved)");
    ok(two[0].text === "methodology" && two[1].text === "rep intake", "layer order preserved");
    ok(
      two[0].cache_control?.type === "ephemeral" &&
        two[1].cache_control?.type === "ephemeral",
      "both stable layers get their own breakpoint (methodology + rep intake)",
    );

    // cache:false opts a layer out of a breakpoint.
    const optOut = buildCachedSystem([
      { text: "methodology" },
      { text: "volatile-ish", cache: false },
    ]);
    ok(
      optOut[0].cache_control !== undefined && optOut[1].cache_control === undefined,
      "cache:false layer gets no breakpoint",
    );

    // Empty / whitespace layers are dropped.
    const dropped = buildCachedSystem([
      { text: "" },
      { text: "   \n  " },
      { text: "real" },
    ]);
    ok(dropped.length === 1 && dropped[0].text === "real", "empty/whitespace layers dropped");

    // More cacheable layers than the cap → only the first MAX get markers.
    const many = buildCachedSystem(
      Array.from({ length: MAX_CACHE_BREAKPOINTS + 2 }, (_, i) => ({ text: `L${i}` })),
    );
    const marked = many.filter((b) => b.cache_control).length;
    ok(
      marked === MAX_CACHE_BREAKPOINTS,
      `breakpoints capped at MAX_CACHE_BREAKPOINTS (${MAX_CACHE_BREAKPOINTS})`,
    );
    ok(
      many[0].cache_control !== undefined && many[many.length - 1].cache_control === undefined,
      "the EARLIEST (most-reused) layers get the markers, not the last",
    );

    ok(buildCachedSystem([]).length === 0, "no layers → empty system array");
  }

  // ---------- summarizeCacheUsage ----------
  {
    const full = summarizeCacheUsage({
      input_tokens: 100,
      output_tokens: 40,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 2000,
    });
    ok(full.cacheReadTokens === 2000, "reads the cache_read field");
    ok(full.totalPromptTokens === 2100, "total = input + creation + read");
    ok(Math.abs(full.cacheHitRate - 2000 / 2100) < 1e-9, "hit rate = read / total");
    ok(full.cacheHit === true, "cacheHit true when read > 0");

    const firstCall = summarizeCacheUsage({
      input_tokens: 50,
      cache_creation_input_tokens: 2000,
      cache_read_input_tokens: 0,
    });
    ok(firstCall.cacheCreationTokens === 2000, "first call shows creation tokens");
    ok(firstCall.cacheHit === false, "first call (write only) is not a hit");
    ok(firstCall.cacheHitRate === 0, "first call hit rate is 0");

    const missing = summarizeCacheUsage(undefined);
    ok(missing.totalPromptTokens === 0, "undefined usage → all zeros");
    ok(missing.cacheHitRate === 0 && !Number.isNaN(missing.cacheHitRate), "no NaN on empty usage");
    ok(missing.cacheHit === false, "empty usage is not a hit");

    const garbage = summarizeCacheUsage({
      input_tokens: -5 as unknown as number,
      cache_read_input_tokens: Number.NaN as unknown as number,
    });
    ok(garbage.inputTokens === 0 && garbage.cacheReadTokens === 0, "negative/NaN coerced to 0");

    ok(
      formatCacheUsage(full).includes("read=2000") && formatCacheUsage(full).includes("hitRate="),
      "formatCacheUsage renders counts + hit rate",
    );
  }

  // ---------- minCacheableTokens ----------
  {
    // Advisory floor — 1024 for Sonnet 4.6, matching the Phase 17 live probe that
    // showed the ~1567-token methodology block caches (the doc's 2048 over-warns).
    ok(minCacheableTokens("claude-sonnet-4-6") === 1024, "Sonnet 4.6 advisory floor is 1024 tokens");
    ok(minCacheableTokens("claude-opus-4-8") === 4096, "Opus 4.8 advisory floor is 4096 tokens");
    ok(minCacheableTokens("unknown-model") === 1024, "unknown model defaults to 1024");
  }

  // ---------- scoring request still carries the breakpoint (Phase 16 regression) ----------
  {
    const req = buildScoringRequest({ text: "hi", status: "completed", wordCount: 1 });
    ok(req.system.length === 1, "scoring request has one methodology system block");
    ok(
      req.system[0].cache_control?.type === "ephemeral",
      "methodology block still carries a cache_control breakpoint (via buildCachedSystem)",
    );
    ok(req.model === SCORING_MODEL, "scoring request still uses the locked model");
  }

  // ---------- AnthropicScorer surfaces usage via onUsage (fake fetch) ----------
  {
    const prevKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-key"; // requireApiKey() only checks presence
    const captured: CacheUsageSummary[] = [];
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                dimensions: { situation: { score: 3, rationale: "r", evidence: ["q"] } },
                overallStrengths: [],
                overallImprovements: [],
                summary: "ok",
              }),
            },
          ],
          usage: {
            input_tokens: 30,
            output_tokens: 200,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 2048,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    const scorer = new AnthropicScorer({
      fetchImpl: fakeFetch,
      onUsage: (u) => captured.push(u),
    });
    const raw = await scorer.score({ text: "Rep: hi", status: "completed", wordCount: 2 });
    ok(raw.dimensions.situation?.score === 3, "scorer still parses the model JSON");
    ok(captured.length === 1, "onUsage fired exactly once per call");
    ok(captured[0]?.cacheReadTokens === 2048, "onUsage received the cache_read tokens");
    ok(captured[0]?.cacheHit === true, "onUsage reports a cache hit");

    // A throwing onUsage must NOT sink a good score.
    const scorer2 = new AnthropicScorer({
      fetchImpl: fakeFetch,
      onUsage: () => {
        throw new Error("telemetry boom");
      },
    });
    let scoreOk = false;
    try {
      const r2 = await scorer2.score({ text: "x", status: "completed", wordCount: 1 });
      scoreOk = r2.dimensions.situation?.score === 3;
    } catch {
      scoreOk = false;
    }
    ok(scoreOk, "a throwing onUsage callback does not fail the score");

    if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevKey;
  }

  console.log(
    fails.length === 0
      ? `\n✅ Phase 17 verification PASSED — all checks green.`
      : `\n❌ Phase 17 verification FAILED — ${fails.length} check(s):\n  - ${fails.join("\n  - ")}`,
  );
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("✗ verify-phase17 crashed:", e);
  process.exit(1);
});
