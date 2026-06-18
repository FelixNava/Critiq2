/**
 * Phase 24 unit verification — rep consolidation (SEMANTIC memory for REPS), against a
 * FAKE generator + hand-built sample JSON (no network, no DB). Imports the REAL app
 * modules (no re-implementation, per the standing rule). The actual Claude round-trip +
 * the claim/finish lifecycle are exercised by a throwaway real-Postgres + real-Claude
 * probe (not committed); this proves the prompt + output contract, the SOURCE-
 * ATTRIBUTION guardrail (traits citing an unknown debrief are dropped), the empty-result
 * rejection, the request construction (model + the single cached methodology layer), the
 * EVERY-10 threshold math, and the pure rep-consolidation-eligibility decision across all
 * branches — deterministically.
 *
 * Run: pnpm tsx scripts/verify-phase24.ts
 */
import {
  buildSystemPrompt,
  buildUserPrompt,
  buildOutputFormatSpec,
} from "../src/lib/repconsolidation/prompt";
import {
  REP_CONSOLIDATION_MODEL,
  buildRepConsolidationRequest,
  coerceTraits,
  coerceLens,
  extractRepConsolidationFromResponse,
  extractJsonObject,
  parseRepConsolidationJson,
  AnthropicRepConsolidationGenerator,
  AnthropicRepConsolidationError,
} from "../src/lib/repconsolidation/anthropic";
import {
  repConsolidationEligibility,
  repConsolidationThreshold,
  STALE_PROCESSING_MS,
  MAX_REP_CONSOLIDATION_ATTEMPTS,
} from "../src/lib/repconsolidation/store";
import {
  REP_TRAIT_LENSES,
  MAX_DEBRIEFS_PER_REP_CONSOLIDATION,
  REP_CONSOLIDATION_INTERVAL,
  type RepConsolidationContext,
  type RepDebriefDigest,
} from "../src/lib/repconsolidation/types";

const fails: string[] = [];
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) fails.push(msg);
};

function digest(
  label: string,
  over: Partial<RepDebriefDigest> = {},
): RepDebriefDigest {
  return {
    debriefId: `id-${label}`,
    label,
    occurredAt: new Date("2026-06-18T12:00:00Z"),
    accountName: "Riverside Contractors",
    recap: "Met with the buyer about the spring repaint program.",
    observations: [{ note: "Jumped to next steps before naming the cost of the delay", lens: "structure" }],
    commitments: ["Send the quote by Friday"],
    openQuestions: ["Who signs off above $50k?"],
    summary: "Good rapport, light on implication.",
    ...over,
  };
}

function ctx(over: Partial<RepConsolidationContext> = {}): RepConsolidationContext {
  return {
    debriefs: [digest("D1"), digest("D2", { accountName: "Acme Stores" })],
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
    ok(sys.includes("rep memory"), "system prompt frames Critiq as rep memory");
    ok(/private/i.test(sys), "system prompt states the profile is private to the rep");
    ok(
      /sourceDebriefId/i.test(sys) && /attribut/i.test(sys),
      "system prompt states the source-attribution hard rule",
    );
    ok(
      /observational|do NOT write advice|not prescriptive/i.test(sys),
      "system prompt keeps the profile observational (advice is the coaching step)",
    );
    ok(
      sys.includes(buildOutputFormatSpec()),
      "system prompt embeds the JSON output contract",
    );
    for (const lens of REP_TRAIT_LENSES) {
      ok(buildOutputFormatSpec().includes(lens), `output spec lists lens "${lens}"`);
    }
  }

  // ---------- User prompt renders the labeled, account-tagged debrief history ----------
  {
    const user = buildUserPrompt(ctx());
    ok(user.includes("id=D1") && user.includes("id=D2"), "user prompt labels each debrief id");
    ok(
      user.includes("account: Riverside Contractors") && user.includes("account: Acme Stores"),
      "user prompt tags each debrief with its account (cross-account context)",
    );
    ok(user.includes("newest first"), "user prompt states newest-first ordering");
    ok(user.includes("across the rep's accounts"), "user prompt frames the history as cross-account");
    ok(!user.includes("older debrief(s) are not shown"), "no truncation note when full history fits");

    const userTrunc = buildUserPrompt(ctx({ truncatedOlderCount: 7 }));
    ok(
      userTrunc.includes("7 older debrief(s) are not shown"),
      "user prompt discloses truncated older debriefs honestly",
    );
  }

  // ---------- Request construction: model + single cached methodology layer ----------
  {
    const req = buildRepConsolidationRequest(ctx());
    ok(req.model === REP_CONSOLIDATION_MODEL, `request uses ${REP_CONSOLIDATION_MODEL}`);
    ok(req.model === "claude-sonnet-4-6", "model is the locked Sonnet 4.x choice");
    ok(req.thinking.type === "adaptive", "adaptive thinking is on");
    ok(req.system.length === 1, "exactly ONE system layer (no static-intake layer — this BUILDS the profile)");
    ok(
      req.system[0].cache_control?.type === "ephemeral",
      "the methodology layer carries the cache breakpoint",
    );
    ok(req.messages.length === 1 && req.messages[0].role === "user", "one user message");
  }

  // ---------- Lens coercion ----------
  {
    ok(coerceLens("communication") === "communication", "known lens passes through");
    ok(coerceLens("RELATIONSHIP") === "relationship", "lens is case-insensitive");
    ok(coerceLens("nonsense") === "general", "unknown lens → general");
    ok(coerceLens(undefined) === "general", "missing lens → general");
  }

  // ---------- SOURCE-ATTRIBUTION guardrail (the heart of the phase) ----------
  {
    const valid = new Set(["D1", "D2"]);
    const traits = coerceTraits(
      [
        { text: "Builds rapport before pitching", lens: "relationship", sourceDebriefId: "D1" },
        { text: "Hallucinated pattern", lens: "structure", sourceDebriefId: "D9" }, // unknown → drop
        { text: "", lens: "structure", sourceDebriefId: "D2" }, // no text → drop
        { text: "Tends to skip implication questions", lens: "structure", sourceDebriefId: "D2" },
        { text: "no source at all", lens: "general" }, // missing source → drop
      ],
      valid,
    );
    ok(traits.length === 2, "traits citing an unknown/missing debrief id are dropped");
    ok(
      traits.every((t) => valid.has(t.sourceDebriefId)),
      "every surviving trait is attributed to a valid debrief label",
    );
    ok(
      traits.some((t) => t.text === "Builds rapport before pitching") &&
        traits.some((t) => t.text === "Tends to skip implication questions"),
      "well-attributed traits survive",
    );
    ok(coerceTraits("not an array", valid).length === 0, "non-array traits → []");
  }

  // ---------- parseRepConsolidationJson ----------
  {
    const valid = new Set(["D1"]);
    const r = parseRepConsolidationJson(
      {
        headline: "  Relationship-strong, discovery-light  ",
        narrative: "Consistently warm; tends to advance before surfacing the cost of inaction.",
        traits: [{ text: "Strong rapport-building", lens: "relationship", sourceDebriefId: "D1" }],
      },
      valid,
    );
    ok(r.headline === "Relationship-strong, discovery-light", "headline trimmed");
    ok(r.narrative.startsWith("Consistently warm"), "narrative preserved");
    ok(r.traits.length === 1, "valid trait kept");
    const empty = parseRepConsolidationJson({}, valid);
    ok(empty.headline === "" && empty.narrative === "" && empty.traits.length === 0, "missing fields → empty");
  }

  // ---------- extractJsonObject (fence / span tolerance) ----------
  {
    ok((extractJsonObject('```json\n{"a":1}\n```') as { a: number })?.a === 1, "strips a ```json fence");
    ok((extractJsonObject('Here:\n{"b":2} done') as { b: number })?.b === 2, "falls back to the outermost {...} span");
    ok(extractJsonObject("no json here") === null, "unparseable → null");
  }

  // ---------- extractRepConsolidationFromResponse ----------
  {
    const valid = new Set(["D1", "D2"]);
    const good = extractRepConsolidationFromResponse(
      resp({
        headline: "Closer who under-diagnoses",
        narrative: "Advances deals confidently; recurringly light on implication across accounts.",
        traits: [{ text: "Light on implication questions", lens: "structure", sourceDebriefId: "D1" }],
      }),
      valid,
    );
    ok(good.traits.length === 1 && good.narrative.length > 0, "well-formed response parses");

    // Empty result (no narrative AND no traits) → rejected.
    let threwEmpty = false;
    try {
      extractRepConsolidationFromResponse(resp({ headline: "x", narrative: "", traits: [] }), valid);
    } catch (e) {
      threwEmpty = e instanceof AnthropicRepConsolidationError;
    }
    ok(threwEmpty, "empty result (no narrative + no traits) is rejected");

    // A narrative with zero traits is still usable (sparse but grounded).
    const narrativeOnly = extractRepConsolidationFromResponse(
      resp({ headline: "Early read", narrative: "Ten calls in; rapport-first style is emerging.", traits: [] }),
      valid,
    );
    ok(narrativeOnly.traits.length === 0 && narrativeOnly.narrative.length > 0, "narrative-only result is accepted");

    // All traits unattributable → dropped → with no narrative, that's empty → reject.
    let threwAllDropped = false;
    try {
      extractRepConsolidationFromResponse(
        resp({ headline: "", narrative: "", traits: [{ text: "x", lens: "general", sourceDebriefId: "D99" }] }),
        valid,
      );
    } catch (e) {
      threwAllDropped = e instanceof AnthropicRepConsolidationError;
    }
    ok(threwAllDropped, "a response whose only traits are unattributable is rejected as empty");

    // Refusal + truncation.
    for (const [stop, label] of [["refusal", "refusal"], ["max_tokens", "truncation"]] as const) {
      let threw = false;
      try {
        extractRepConsolidationFromResponse(resp({ headline: "h", narrative: "n", traits: [] }, stop), valid);
      } catch (e) {
        threw = e instanceof AnthropicRepConsolidationError;
      }
      ok(threw, `${label} (stop_reason=${stop}) throws`);
    }

    // Non-JSON body.
    let threwBadJson = false;
    try {
      extractRepConsolidationFromResponse(
        { stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] },
        valid,
      );
    } catch (e) {
      threwBadJson = e instanceof AnthropicRepConsolidationError;
    }
    ok(threwBadJson, "non-JSON response body throws");
  }

  // ---------- The generator drops unknown-source traits end-to-end (fake fetch) ----------
  {
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify(
          resp({
            headline: "Rapport-first",
            narrative: "Warm opener every call; advances before surfacing cost.",
            traits: [
              { text: "Opens with genuine curiosity", lens: "relationship", sourceDebriefId: "D1" },
              { text: "INVENTED quota-pressure tell", lens: "general", sourceDebriefId: "D7" }, // unknown → drop
            ],
          }),
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;
    process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "test-key";
    const gen = new AnthropicRepConsolidationGenerator({ fetchImpl: fakeFetch });
    const result = await gen.generate(ctx({ debriefs: [digest("D1"), digest("D2")] }));
    ok(result.traits.length === 1, "generator keeps only the attributable trait");
    ok(result.traits[0].sourceDebriefId === "D1", "the surviving trait is attributed to a real input label");
  }

  // ---------- The EVERY-10 threshold math (the distinctive cadence) ----------
  {
    ok(REP_CONSOLIDATION_INTERVAL === 10, "the locked interval is every 10 debriefs");
    ok(repConsolidationThreshold(0) === 0, "0 debriefs → threshold 0");
    ok(repConsolidationThreshold(9) === 0, "9 debriefs → threshold 0 (below the first interval)");
    ok(repConsolidationThreshold(10) === 10, "10 debriefs → threshold 10");
    ok(repConsolidationThreshold(14) === 10, "14 debriefs → still threshold 10 (no in-between regen)");
    ok(repConsolidationThreshold(20) === 20, "20 debriefs → threshold 20");
    ok(repConsolidationThreshold(37) === 30, "37 debriefs → threshold 30");
    ok(repConsolidationThreshold(-5) === 0, "negative → 0 (fail safe)");
    ok(repConsolidationThreshold(Number.NaN) === 0, "NaN → 0 (fail safe)");
  }

  // ---------- repConsolidationEligibility (the pure work-list / claim decision) ----------
  {
    const NOW = 1_000_000_000_000;
    const fresh = new Date(NOW - 1000);
    const stale = new Date(NOW - STALE_PROCESSING_MS - 1000);

    // Below the first interval → never eligible (the static intake carries the rep).
    ok(!repConsolidationEligibility(null, 0, NOW).eligible, "0 completed debriefs → not eligible");
    ok(!repConsolidationEligibility(null, 9, NOW).eligible, "9 completed debriefs → not eligible (below interval)");

    // First interval reached → eligible + new material.
    const firstTime = repConsolidationEligibility(null, 10, NOW);
    ok(firstTime.eligible && firstTime.isNewMaterial && firstTime.threshold === 10, "10 debriefs, never consolidated → eligible (threshold 10)");

    // Completed at threshold 10, now at 14 (still threshold 10) → NOT eligible (no in-between regen).
    ok(
      !repConsolidationEligibility({ status: "completed", attempts: 1, debriefCount: 10, startedAt: fresh }, 14, NOW).eligible,
      "completed@10 + 14 debriefs (same threshold) → not eligible",
    );
    // Completed at threshold 10, now at 20 → new threshold → eligible + new material.
    const newThreshold = repConsolidationEligibility({ status: "completed", attempts: 1, debriefCount: 10, startedAt: fresh }, 20, NOW);
    ok(newThreshold.eligible && newThreshold.isNewMaterial && newThreshold.threshold === 20, "completed@10 + 20 debriefs → eligible (new threshold 20)");

    // Fresh processing → not eligible (let it finish).
    ok(
      !repConsolidationEligibility({ status: "processing", attempts: 1, debriefCount: 10, startedAt: fresh }, 10, NOW).eligible,
      "fresh processing claim → not eligible",
    );
    // Stale processing under the cap → eligible (dead run reclaim).
    ok(
      repConsolidationEligibility({ status: "processing", attempts: 1, debriefCount: 10, startedAt: stale }, 10, NOW).eligible,
      "stale processing claim under the cap → eligible (reclaim)",
    );
    // Stale processing AT the cap (same threshold) → NOT eligible — must agree with claim ('exhausted').
    ok(
      !repConsolidationEligibility({ status: "processing", attempts: MAX_REP_CONSOLIDATION_ATTEMPTS, debriefCount: 10, startedAt: stale }, 10, NOW).eligible,
      "stale processing AT the cap (same threshold) → not eligible (mirrors claim 'exhausted')",
    );
    // Fresh processing BUT new threshold → still not eligible until the run settles.
    ok(
      !repConsolidationEligibility({ status: "processing", attempts: 1, debriefCount: 10, startedAt: fresh }, 20, NOW).eligible,
      "fresh processing + new threshold → not eligible until the run settles",
    );

    // Pending/failed under cap → eligible (retry); at cap → not eligible (bounded).
    ok(
      repConsolidationEligibility({ status: "failed", attempts: MAX_REP_CONSOLIDATION_ATTEMPTS - 1, debriefCount: 10, startedAt: fresh }, 10, NOW).eligible,
      "failed under the attempts cap → eligible (retry)",
    );
    ok(
      !repConsolidationEligibility({ status: "failed", attempts: MAX_REP_CONSOLIDATION_ATTEMPTS, debriefCount: 10, startedAt: fresh }, 10, NOW).eligible,
      "failed at the attempts cap (same threshold) → not eligible (bounded loss)",
    );
    // …but a NEW threshold resets that: failed-at-cap@10 + crossing 20 → eligible again.
    const cappedButNew = repConsolidationEligibility({ status: "failed", attempts: MAX_REP_CONSOLIDATION_ATTEMPTS, debriefCount: 10, startedAt: fresh }, 20, NOW);
    ok(cappedButNew.eligible && cappedButNew.isNewMaterial, "failed-at-cap + NEW threshold → eligible again (fresh budget)");
  }

  // ---------- Constants sanity ----------
  {
    ok(MAX_DEBRIEFS_PER_REP_CONSOLIDATION > 0, "a positive per-consolidation debrief cap is set");
    ok(MAX_REP_CONSOLIDATION_ATTEMPTS === 3, "attempts cap is 3 (mirrors the account/score/transcript sweepers)");
  }

  console.log(
    fails.length === 0
      ? `\n✅ Phase 24 unit verification PASSED`
      : `\n❌ ${fails.length} check(s) FAILED:\n - ${fails.join("\n - ")}`,
  );
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("verify-phase24 crashed:", e);
  process.exit(1);
});
