/**
 * Phase 16 unit verification — three-pillar SPIN/Voss/Navarro scoring, against a
 * FAKE Scorer + hand-built raw judgements (no network, no Anthropic call).
 * Imports the REAL app modules (no re-implementation, per the standing rule). The
 * actual Claude round-trip + scoring QUALITY are the runtime gate Felix + the
 * expert coach validate; this proves the rubric integrity, prompt + schema
 * construction, response parsing/refusal handling, and the clamp/aggregate math
 * deterministically.
 *
 * Run: pnpm tsx scripts/verify-phase16.ts
 */
import {
  DIMENSIONS,
  DIMENSION_KEYS,
  OVERALL_MAX,
  PILLARS,
  assertRubricIntegrity,
  dimensionsForPillar,
  maxForDimension,
} from "../src/lib/scoring/rubric";
import {
  buildOutputSchema,
  buildSystemPrompt,
  buildUserPrompt,
} from "../src/lib/scoring/prompt";
import {
  SCORING_MODEL,
  buildScoringRequest,
  extractJsonObject,
  extractScoreFromResponse,
  parseScoreJson,
} from "../src/lib/scoring/anthropic";
import { aggregateRawScore, scoreTranscript } from "../src/lib/scoring/score";
import type { RawScoreResult, Scorer } from "../src/lib/scoring/types";

const fails: string[] = [];
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) fails.push(msg);
};

function fullRaw(scorePerDim: number): RawScoreResult {
  const dimensions: RawScoreResult["dimensions"] = {};
  for (const d of DIMENSIONS) {
    dimensions[d.key] = { score: scorePerDim, rationale: "r", evidence: ["e"] };
  }
  return { dimensions, overallStrengths: [], overallImprovements: [], summary: "s" };
}

async function main() {
// ---------- Rubric integrity ----------
{
  let threw = false;
  try {
    assertRubricIntegrity();
  } catch {
    threw = true;
  }
  ok(!threw, "rubric integrity assertion passes (weights sum correctly)");
  ok(
    dimensionsForPillar("spin").reduce((n, d) => n + d.maxPoints, 0) === 35,
    "SPIN sub-dimensions sum to 35",
  );
  ok(
    dimensionsForPillar("voss").reduce((n, d) => n + d.maxPoints, 0) === 35,
    "Voss sub-dimensions sum to 35",
  );
  ok(
    dimensionsForPillar("navarro").reduce((n, d) => n + d.maxPoints, 0) === 30,
    "Navarro sub-dimensions sum to 30",
  );
  ok(
    PILLARS.spin.maxPoints + PILLARS.voss.maxPoints + PILLARS.navarro.maxPoints ===
      OVERALL_MAX,
    "three pillar ceilings sum to 100",
  );
  ok(DIMENSION_KEYS.length === DIMENSIONS.length, "DIMENSION_KEYS covers all dimensions");
  ok(maxForDimension("implication") === 10, "maxForDimension reads a known key");
  ok(maxForDimension("nope") === 0, "maxForDimension returns 0 for unknown key");
}

// ---------- Prompt construction ----------
{
  const sys = buildSystemPrompt();
  ok(sys.includes("SPIN Selling"), "system prompt names the SPIN pillar");
  ok(sys.includes("Voss"), "system prompt names the Voss pillar");
  ok(sys.includes("Navarro"), "system prompt names the Navarro pillar");
  ok(
    DIMENSIONS.every((d) => sys.includes(`key: "${d.key}"`)),
    "system prompt lists every dimension key (single source of truth)",
  );
  ok(sys.includes("VERBATIM"), "system prompt requires verbatim evidence");
  ok(
    sys.includes("ONLY the sales representative"),
    "system prompt scopes scoring to the rep, not the buyer",
  );
  ok(sys.includes("OUTPUT FORMAT:"), "system prompt includes the JSON output contract");
  ok(
    DIMENSIONS.every((d) => sys.includes(`"${d.key}" (integer 0–${d.maxPoints})`)),
    "output contract lists every dimension key with its max",
  );

  const user = buildUserPrompt({ text: "Rep: hello there", status: "completed", wordCount: 3 });
  ok(user.includes("Rep: hello there"), "user prompt embeds the transcript");
  ok(user.includes("TRANSCRIPT START"), "user prompt fences the transcript");
  ok(
    !user.includes("PARTIAL"),
    "completed transcript user prompt has no partial note",
  );
  const partialUser = buildUserPrompt({ text: "x", status: "partial", wordCount: 1 });
  ok(partialUser.includes("PARTIAL"), "partial transcript user prompt discloses the gap");
  const emptyUser = buildUserPrompt({ text: "   ", status: "completed", wordCount: 0 });
  ok(emptyUser.includes("(empty transcript)"), "empty transcript falls back to a marker");
}

// ---------- Output schema ----------
{
  const schema = buildOutputSchema() as any;
  ok(schema.type === "object", "schema root is an object");
  ok(schema.additionalProperties === false, "schema root forbids extra props");
  const dimProps = schema.properties.dimensions.properties;
  ok(
    DIMENSIONS.every((d) => dimProps[d.key]),
    "schema has a property for every dimension",
  );
  ok(
    schema.properties.dimensions.required.length === DIMENSIONS.length,
    "schema requires every dimension",
  );
  const sample = dimProps[DIMENSIONS[0].key];
  ok(
    sample.required.includes("score") &&
      sample.required.includes("rationale") &&
      sample.required.includes("evidence"),
    "each dimension requires score + rationale + evidence",
  );
  ok(
    sample.additionalProperties === false,
    "each dimension object forbids extra props",
  );
}

// ---------- Request construction ----------
{
  const req = buildScoringRequest({ text: "hi", status: "completed", wordCount: 1 });
  ok(req.model === SCORING_MODEL, `request uses the locked model (${SCORING_MODEL})`);
  ok(req.model === "claude-sonnet-4-6", "model is claude-sonnet-4-6");
  ok(req.thinking.type === "adaptive", "request uses adaptive thinking");
  ok(
    req.system[0].cache_control?.type === "ephemeral",
    "methodology system block carries a cache_control breakpoint",
  );
  ok(req.thinking.type === "adaptive", "request keeps adaptive thinking");
  ok(req.messages[0].role === "user", "request has a single user message");
}

// ---------- JSON extraction (fence/prose tolerant) ----------
{
  ok(
    (extractJsonObject('{"a":1}') as any)?.a === 1,
    "extractJsonObject parses bare JSON",
  );
  ok(
    (extractJsonObject('```json\n{"a":2}\n```') as any)?.a === 2,
    "extractJsonObject strips a ```json code fence",
  );
  ok(
    (extractJsonObject('Here you go:\n{"a":3}\nDone.') as any)?.a === 3,
    "extractJsonObject recovers JSON wrapped in prose",
  );
  ok(extractJsonObject("not json at all") === null, "extractJsonObject returns null on garbage");
}

// ---------- Response parsing ----------
{
  // refusal → throws
  let refused = false;
  try {
    extractScoreFromResponse({ stop_reason: "refusal", content: [] });
  } catch {
    refused = true;
  }
  ok(refused, "a refusal stop_reason throws");

  // empty content → throws
  let empty = false;
  try {
    extractScoreFromResponse({ stop_reason: "end_turn", content: [] });
  } catch {
    empty = true;
  }
  ok(empty, "empty content throws");

  // non-JSON text → throws
  let badJson = false;
  try {
    extractScoreFromResponse({
      content: [{ type: "text", text: "not json" }],
    });
  } catch {
    badJson = true;
  }
  ok(badJson, "non-JSON text throws");

  // thinking block + valid JSON text block → extracts the JSON
  const valid = extractScoreFromResponse({
    stop_reason: "end_turn",
    content: [
      { type: "thinking", text: "...reasoning..." },
      {
        type: "text",
        text: JSON.stringify({
          dimensions: { situation: { score: 4, rationale: "asked context", evidence: ["q1"] } },
          overallStrengths: ["good rapport"],
          overallImprovements: ["develop implications"],
          summary: "Solid opener.",
        }),
      },
    ],
  });
  ok(
    valid.dimensions.situation?.score === 4,
    "extracts the structured JSON past the thinking block",
  );
  ok(valid.overallStrengths[0] === "good rapport", "extracts overall strengths");

  // parseScoreJson tolerant of missing/garbage fields
  const tol = parseScoreJson({ dimensions: { problem: { score: "x", evidence: "nope" } } });
  ok(tol.dimensions.problem.score === 0, "non-numeric score coerced to 0");
  ok(Array.isArray(tol.dimensions.problem.evidence), "non-array evidence coerced to []");
  ok(tol.summary === "", "missing summary coerced to empty string");
}

// ---------- Aggregation math ----------
{
  // Perfect score = each dim at its max → 100
  const perfectDims: RawScoreResult["dimensions"] = {};
  for (const d of DIMENSIONS) {
    perfectDims[d.key] = { score: d.maxPoints, rationale: "r", evidence: ["e"] };
  }
  const perfect = aggregateRawScore({
    dimensions: perfectDims,
    overallStrengths: [],
    overallImprovements: [],
    summary: "",
  });
  ok(perfect.overall === 100, "all-max judgement aggregates to 100");
  ok(perfect.pillars.spin.score === 35, "SPIN pillar aggregates to 35 at max");
  ok(perfect.pillars.voss.score === 35, "Voss pillar aggregates to 35 at max");
  ok(perfect.pillars.navarro.score === 30, "Navarro pillar aggregates to 30 at max");
  ok(!perfect.partialJudgement, "complete judgement is not flagged partial");

  // Over-max scores are clamped to the rubric ceiling
  const over = aggregateRawScore(fullRaw(999));
  ok(over.overall === 100, "wildly-over scores clamp to 100");
  ok(
    over.dimensions.every((d) => d.score === d.maxPoints),
    "every over-max dimension clamps to its own ceiling",
  );

  // Negative scores clamp to 0
  const neg = aggregateRawScore(fullRaw(-5));
  ok(neg.overall === 0, "negative scores clamp to 0");

  // Missing dimensions default to 0 AND trip partialJudgement
  const partial = aggregateRawScore({
    dimensions: { situation: { score: 5, rationale: "r", evidence: [] } },
    overallStrengths: [],
    overallImprovements: [],
    summary: "",
  });
  ok(partial.partialJudgement, "an omitted dimension trips partialJudgement");
  ok(partial.overall === 5, "only the present dimension contributes (others default 0)");
  ok(
    partial.dimensions.length === DIMENSIONS.length,
    "aggregate still emits a row for every rubric dimension",
  );

  // dimensions come back in rubric order
  ok(
    partial.dimensions.map((d) => d.key).join(",") === DIMENSION_KEYS.join(","),
    "aggregated dimensions are in rubric order",
  );
}

// ---------- End-to-end with a fake Scorer ----------
{
  const fakeScorer: Scorer = {
    async score() {
      const dimensions: RawScoreResult["dimensions"] = {};
      for (const d of DIMENSIONS) {
        dimensions[d.key] = { score: Math.ceil(d.maxPoints / 2), rationale: "ok", evidence: ["quote"] };
      }
      return {
        dimensions,
        overallStrengths: ["warm"],
        overallImprovements: ["close harder"],
        summary: "Decent call.",
      };
    },
  };
  const result = await scoreTranscript(
    { text: "Rep: ... Buyer: ...", status: "completed", wordCount: 4 },
    fakeScorer,
  );
  const expected = DIMENSIONS.reduce((n, d) => n + Math.ceil(d.maxPoints / 2), 0);
  ok(result.overall === expected, `end-to-end overall matches summed dimensions (${expected})`);
  ok(result.overall > 0 && result.overall <= 100, "end-to-end overall is in [1,100]");
  ok(result.summary === "Decent call.", "end-to-end carries the summary through");
  ok(result.overallImprovements[0] === "close harder", "end-to-end carries coaching seeds");
}

  console.log(
    fails.length === 0
      ? `\n✅ Phase 16 verification PASSED — all checks green.`
      : `\n❌ Phase 16 verification FAILED — ${fails.length} check(s):\n  - ${fails.join("\n  - ")}`,
  );
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("✗ verify-phase16 crashed:", e);
  process.exit(1);
});
