/**
 * Phase 23 unit verification — account consolidation (SEMANTIC memory for accounts),
 * against a FAKE generator + hand-built sample JSON (no network, no DB). Imports the
 * REAL app modules (no re-implementation, per the standing rule). The actual Claude
 * round-trip + the claim/finish/write-back lifecycle are exercised by a throwaway
 * real-Postgres + real-Claude probe (not committed); this proves the prompt + output
 * contract, the SOURCE-ATTRIBUTION guardrail (facts citing an unknown debrief are
 * dropped), the empty-result rejection, the request construction (model + the single
 * cached methodology layer), and the pure consolidation-eligibility decision across
 * all branches — deterministically.
 *
 * Run: pnpm tsx scripts/verify-phase23.ts
 */
import {
  buildSystemPrompt,
  buildUserPrompt,
  buildOutputFormatSpec,
} from "../src/lib/consolidation/prompt";
import {
  CONSOLIDATION_MODEL,
  buildConsolidationRequest,
  coerceFacts,
  coerceLens,
  extractConsolidationFromResponse,
  extractJsonObject,
  parseConsolidationJson,
  AnthropicConsolidationGenerator,
  AnthropicConsolidationError,
} from "../src/lib/consolidation/anthropic";
import {
  consolidationEligibility,
  STALE_PROCESSING_MS,
  MAX_CONSOLIDATION_ATTEMPTS,
} from "../src/lib/consolidation/store";
import {
  ACCOUNT_FACT_LENSES,
  MAX_DEBRIEFS_PER_CONSOLIDATION,
  type ConsolidationContext,
  type DebriefDigest,
} from "../src/lib/consolidation/types";

const fails: string[] = [];
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) fails.push(msg);
};

function digest(
  label: string,
  over: Partial<DebriefDigest> = {},
): DebriefDigest {
  return {
    debriefId: `id-${label}`,
    label,
    occurredAt: new Date("2026-06-18T12:00:00Z"),
    recap: "Met with the buyer about the spring repaint program.",
    observations: [{ note: "Asked about budget timing", lens: "structure" }],
    commitments: ["Send the quote by Friday"],
    openQuestions: ["Who signs off above $50k?"],
    summary: "Good progress on the repaint program.",
    ...over,
  };
}

function ctx(over: Partial<ConsolidationContext> = {}): ConsolidationContext {
  return {
    accountName: "Riverside Contractors",
    accountStage: "active",
    debriefs: [digest("D1"), digest("D2")],
    truncatedOlderCount: 0,
    ...over,
  };
}

// A Messages-API response envelope wrapping a JSON text block (adaptive thinking on).
function resp(obj: unknown, stop_reason = "end_turn") {
  return {
    stop_reason,
    content: [
      { type: "thinking", thinking: "…" },
      { type: "text", text: JSON.stringify(obj) },
    ],
    usage: { input_tokens: 10, output_tokens: 20 },
  };
}

async function main() {
  // ---------- Prompt construction ----------
  {
    const sys = buildSystemPrompt();
    ok(sys.includes("account memory"), "system prompt frames Critiq as account memory");
    ok(
      /sourceDebriefId/i.test(sys) && /attribut/i.test(sys),
      "system prompt states the source-attribution hard rule",
    );
    ok(
      /do NOT write about the rep|do not name the rep|name the rep/i.test(sys),
      "system prompt keeps the summary rep-agnostic (shared account intelligence)",
    );
    ok(
      sys.includes(buildOutputFormatSpec()),
      "system prompt embeds the JSON output contract",
    );
    for (const lens of ACCOUNT_FACT_LENSES) {
      ok(buildOutputFormatSpec().includes(lens), `output spec lists lens "${lens}"`);
    }
  }

  // ---------- User prompt renders the labeled debrief history ----------
  {
    const user = buildUserPrompt(ctx());
    ok(user.includes("Riverside Contractors"), "user prompt names the account");
    ok(user.includes("id=D1") && user.includes("id=D2"), "user prompt labels each debrief id");
    ok(user.includes("newest first"), "user prompt states newest-first ordering");
    ok(!user.includes("older debrief(s) are not shown"), "no truncation note when full history fits");

    const userTrunc = buildUserPrompt(ctx({ truncatedOlderCount: 7 }));
    ok(
      userTrunc.includes("7 older debrief(s) are not shown"),
      "user prompt discloses truncated older debriefs honestly",
    );
  }

  // ---------- Request construction: model + single cached methodology layer ----------
  {
    const req = buildConsolidationRequest(ctx());
    ok(req.model === CONSOLIDATION_MODEL, `request uses ${CONSOLIDATION_MODEL}`);
    ok(req.model === "claude-sonnet-4-6", "model is the locked Sonnet 4.x choice");
    ok(req.thinking.type === "adaptive", "adaptive thinking is on");
    ok(req.system.length === 1, "exactly ONE system layer (no rep layer — rep-agnostic)");
    ok(
      req.system[0].cache_control?.type === "ephemeral",
      "the methodology layer carries the cache breakpoint",
    );
    ok(req.messages.length === 1 && req.messages[0].role === "user", "one user message");
  }

  // ---------- Lens coercion ----------
  {
    ok(coerceLens("structure") === "structure", "known lens passes through");
    ok(coerceLens("COMMUNICATION") === "communication", "lens is case-insensitive");
    ok(coerceLens("nonsense") === "general", "unknown lens → general");
    ok(coerceLens(undefined) === "general", "missing lens → general");
  }

  // ---------- SOURCE-ATTRIBUTION guardrail (the heart of the phase) ----------
  {
    const valid = new Set(["D1", "D2"]);
    const facts = coerceFacts(
      [
        { text: "Budget approved through Q3", lens: "general", sourceDebriefId: "D1" },
        { text: "Hallucinated fact", lens: "structure", sourceDebriefId: "D9" }, // unknown source → drop
        { text: "", lens: "structure", sourceDebriefId: "D2" }, // no text → drop
        { text: "Prefers email follow-up", lens: "communication", sourceDebriefId: "D2" },
        { text: "no source at all", lens: "general" }, // missing source → drop
      ],
      valid,
    );
    ok(facts.length === 2, "facts citing an unknown/missing debrief id are dropped");
    ok(
      facts.every((f) => valid.has(f.sourceDebriefId)),
      "every surviving fact is attributed to a valid debrief label",
    );
    ok(
      facts.some((f) => f.text === "Budget approved through Q3") &&
        facts.some((f) => f.text === "Prefers email follow-up"),
      "well-attributed facts survive",
    );
    ok(coerceFacts("not an array", valid).length === 0, "non-array facts → []");
  }

  // ---------- parseConsolidationJson ----------
  {
    const valid = new Set(["D1"]);
    const r = parseConsolidationJson(
      {
        headline: "  Warming up  ",
        narrative: "Active repaint deal in motion.",
        facts: [{ text: "Quote sent", lens: "structure", sourceDebriefId: "D1" }],
      },
      valid,
    );
    ok(r.headline === "Warming up", "headline trimmed");
    ok(r.narrative === "Active repaint deal in motion.", "narrative preserved");
    ok(r.facts.length === 1, "valid fact kept");
    const empty = parseConsolidationJson({}, valid);
    ok(empty.headline === "" && empty.narrative === "" && empty.facts.length === 0, "missing fields → empty");
  }

  // ---------- extractJsonObject (fence / span tolerance) ----------
  {
    ok(
      (extractJsonObject('```json\n{"a":1}\n```') as { a: number })?.a === 1,
      "strips a ```json fence",
    );
    ok(
      (extractJsonObject('Here:\n{"b":2} done') as { b: number })?.b === 2,
      "falls back to the outermost {...} span",
    );
    ok(extractJsonObject("no json here") === null, "unparseable → null");
  }

  // ---------- extractConsolidationFromResponse ----------
  {
    const valid = new Set(["D1", "D2"]);
    const good = extractConsolidationFromResponse(
      resp({
        headline: "Deal advancing",
        narrative: "The repaint program is progressing; quote out, awaiting sign-off.",
        facts: [{ text: "Awaiting sign-off above $50k", lens: "structure", sourceDebriefId: "D1" }],
      }),
      valid,
    );
    ok(good.facts.length === 1 && good.narrative.length > 0, "well-formed response parses");

    // Empty result (no narrative AND no facts) → rejected.
    let threwEmpty = false;
    try {
      extractConsolidationFromResponse(resp({ headline: "x", narrative: "", facts: [] }), valid);
    } catch (e) {
      threwEmpty = e instanceof AnthropicConsolidationError;
    }
    ok(threwEmpty, "empty result (no narrative + no facts) is rejected");

    // A narrative with zero facts is still usable (sparse but grounded).
    const narrativeOnly = extractConsolidationFromResponse(
      resp({ headline: "Early days", narrative: "One intro call so far; relationship just forming.", facts: [] }),
      valid,
    );
    ok(narrativeOnly.facts.length === 0 && narrativeOnly.narrative.length > 0, "narrative-only result is accepted");

    // All facts unattributable → dropped → with no narrative, that's empty → reject.
    let threwAllDropped = false;
    try {
      extractConsolidationFromResponse(
        resp({ headline: "", narrative: "", facts: [{ text: "x", lens: "general", sourceDebriefId: "D99" }] }),
        valid,
      );
    } catch (e) {
      threwAllDropped = e instanceof AnthropicConsolidationError;
    }
    ok(threwAllDropped, "a response whose only facts are unattributable is rejected as empty");

    // Refusal + truncation.
    for (const [stop, label] of [["refusal", "refusal"], ["max_tokens", "truncation"]] as const) {
      let threw = false;
      try {
        extractConsolidationFromResponse(resp({ headline: "h", narrative: "n", facts: [] }, stop), valid);
      } catch (e) {
        threw = e instanceof AnthropicConsolidationError;
      }
      ok(threw, `${label} (stop_reason=${stop}) throws`);
    }

    // Non-JSON body.
    let threwBadJson = false;
    try {
      extractConsolidationFromResponse(
        { stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] },
        valid,
      );
    } catch (e) {
      threwBadJson = e instanceof AnthropicConsolidationError;
    }
    ok(threwBadJson, "non-JSON response body throws");
  }

  // ---------- The generator drops unknown-source facts end-to-end (fake fetch) ----------
  {
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify(
          resp({
            headline: "Mid-deal",
            narrative: "Repaint program advancing with the buyer.",
            facts: [
              { text: "Quote sent Friday", lens: "structure", sourceDebriefId: "D1" },
              { text: "INVENTED rival vendor", lens: "general", sourceDebriefId: "D7" }, // unknown → drop
            ],
          }),
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;
    process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "test-key";
    const gen = new AnthropicConsolidationGenerator({ fetchImpl: fakeFetch });
    const result = await gen.generate(ctx({ debriefs: [digest("D1"), digest("D2")] }));
    ok(result.facts.length === 1, "generator keeps only the attributable fact");
    ok(
      result.facts[0].sourceDebriefId === "D1",
      "the surviving fact is attributed to a real input label",
    );
  }

  // ---------- consolidationEligibility (the pure work-list / claim decision) ----------
  {
    const NOW = 1_000_000_000_000;
    const fresh = new Date(NOW - 1000);
    const stale = new Date(NOW - STALE_PROCESSING_MS - 1000);

    ok(!consolidationEligibility(null, 0, NOW).eligible, "no completed debriefs → not eligible");
    const firstTime = consolidationEligibility(null, 2, NOW);
    ok(firstTime.eligible && firstTime.isNewMaterial, "never-consolidated account with debriefs → eligible + new material");

    // Completed + current (count == debriefCount) → not eligible.
    ok(
      !consolidationEligibility({ status: "completed", attempts: 1, debriefCount: 3, startedAt: fresh }, 3, NOW).eligible,
      "completed & current → not eligible",
    );
    // Completed + NEW material → eligible + new material (resets attempts at claim).
    const newMat = consolidationEligibility({ status: "completed", attempts: 1, debriefCount: 3, startedAt: fresh }, 4, NOW);
    ok(newMat.eligible && newMat.isNewMaterial, "completed + new material → eligible (new material)");

    // Fresh processing → not eligible (let it finish).
    ok(
      !consolidationEligibility({ status: "processing", attempts: 1, debriefCount: 2, startedAt: fresh }, 2, NOW).eligible,
      "fresh processing claim → not eligible",
    );
    // Stale processing under the cap → eligible (dead run reclaim).
    ok(
      consolidationEligibility({ status: "processing", attempts: 1, debriefCount: 2, startedAt: stale }, 2, NOW).eligible,
      "stale processing claim under the cap → eligible (reclaim)",
    );
    // Stale processing AT the cap (same material) → NOT eligible — must agree with
    // claimConsolidation, which returns 'exhausted' here (no wasted work-list slot).
    ok(
      !consolidationEligibility({ status: "processing", attempts: MAX_CONSOLIDATION_ATTEMPTS, debriefCount: 2, startedAt: stale }, 2, NOW).eligible,
      "stale processing AT the cap (same material) → not eligible (mirrors claim 'exhausted')",
    );
    // Fresh processing BUT new material → still not eligible (the in-flight run may pick it up; next sweep will).
    ok(
      !consolidationEligibility({ status: "processing", attempts: 1, debriefCount: 2, startedAt: fresh }, 5, NOW).eligible,
      "fresh processing + new material → not eligible until the run settles",
    );

    // Pending/failed under cap → eligible (retry); at cap → not eligible (bounded).
    ok(
      consolidationEligibility({ status: "failed", attempts: MAX_CONSOLIDATION_ATTEMPTS - 1, debriefCount: 2, startedAt: fresh }, 2, NOW).eligible,
      "failed under the attempts cap → eligible (retry)",
    );
    ok(
      !consolidationEligibility({ status: "failed", attempts: MAX_CONSOLIDATION_ATTEMPTS, debriefCount: 2, startedAt: fresh }, 2, NOW).eligible,
      "failed at the attempts cap (same material) → not eligible (bounded loss)",
    );
    // …but NEW material resets that: failed-at-cap + a new debrief → eligible again.
    const cappedButNew = consolidationEligibility({ status: "failed", attempts: MAX_CONSOLIDATION_ATTEMPTS, debriefCount: 2, startedAt: fresh }, 3, NOW);
    ok(cappedButNew.eligible && cappedButNew.isNewMaterial, "failed-at-cap + NEW material → eligible again (fresh budget)");
  }

  // ---------- Constants sanity ----------
  {
    ok(MAX_DEBRIEFS_PER_CONSOLIDATION > 0, "a positive per-consolidation debrief cap is set");
    ok(MAX_CONSOLIDATION_ATTEMPTS === 3, "attempts cap is 3 (mirrors the score/transcript sweepers)");
  }

  console.log(
    fails.length === 0
      ? `\n✅ Phase 23 unit verification PASSED`
      : `\n❌ ${fails.length} check(s) FAILED:\n - ${fails.join("\n - ")}`,
  );
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("verify-phase23 crashed:", e);
  process.exit(1);
});
