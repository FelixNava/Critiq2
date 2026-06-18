/**
 * Phase 20 unit verification — post-call debrief (Reporter Mode), pure logic only
 * (no network, no DB). Imports the REAL app modules (no re-implementation, per the
 * standing rule). The real Claude round-trip + the debrief QUALITY are the runtime
 * gate Felix + the expert coach validate; the real-Postgres store/generate path is a
 * throwaway probe. This proves deterministically: the guided-prompt set + report
 * normalization + narration assembly, the reporter prompt + output contract (incl.
 * the neutral/no-grading contract + the lens set), request construction (the two
 * cache layers), and response parsing/normalization (observations incl. bare-string
 * + lens coercion, string lists, empty-debrief rejection).
 *
 * Run: pnpm tsx scripts/verify-phase20.ts
 */
import {
  REPORTER_PROMPTS,
  MAX_HAPPENED,
  MAX_FIELD,
  normalizeReport,
  hasNarrative,
  assembleReportNarration,
} from "../src/lib/debrief/reporter";
import {
  buildSystemPrompt,
  buildOutputFormatSpec,
  buildUserPrompt,
} from "../src/lib/debrief/prompt";
import {
  DEBRIEF_MODEL,
  buildDebriefRequest,
  coerceLens,
  extractJsonObject,
  extractDebriefFromResponse,
  parseDebriefJson,
} from "../src/lib/debrief/anthropic";
import { OBSERVATION_LENSES } from "../src/lib/debrief/types";
import type { DebriefContext } from "../src/lib/debrief/types";

const fails: string[] = [];
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) fails.push(msg);
};

function ctx(over: Partial<DebriefContext> = {}): DebriefContext {
  return {
    accountName: "Riverside Contractors",
    accountStage: "active",
    accountSummary: "Repeat buyer; price-sensitive; values durability.",
    report: {
      objective: "Lock in a walkthrough date",
      happened:
        "Got Dana on the phone, opened with durability, she raised price again.",
      reaction: "Friendly but guarded on price.",
      commitments: "She'll check the budget cap; I'll send the cost sheet Friday.",
      surprises: "GM may be the real decision-maker.",
    },
    repProfile: null,
    ...over,
  };
}

// ---------- Reporter prompts + report shaping ----------
{
  console.log("\n# Reporter prompts");
  const keys = REPORTER_PROMPTS.map((p) => p.key);
  ok(keys.includes("happened"), "prompts include the core narrative field");
  const happened = REPORTER_PROMPTS.find((p) => p.key === "happened");
  ok(!!happened && happened.required, "`happened` is the required prompt");
  ok(
    REPORTER_PROMPTS.filter((p) => p.required).length === 1,
    "exactly one prompt is required (the narrative)",
  );
  ok(
    new Set(keys).size === keys.length,
    "prompt keys are unique",
  );
  ok(
    happened?.max === MAX_HAPPENED &&
      REPORTER_PROMPTS.every((p) =>
        p.key === "happened" ? p.max === MAX_HAPPENED : p.max === MAX_FIELD,
      ),
    "narrative gets MAX_HAPPENED, others MAX_FIELD",
  );

  console.log("\n# normalizeReport");
  const norm = normalizeReport({
    happened: "  walked through it  ",
    reaction: "   ",
    objective: "the goal",
    junk: "ignored",
  });
  ok(norm.happened === "walked through it", "trims the narrative");
  ok(!("reaction" in norm), "drops a whitespace-only optional field");
  ok(norm.objective === "the goal", "keeps a present optional field");
  ok(
    !(norm as unknown as Record<string, unknown>).junk,
    "ignores keys that aren't prompts",
  );
  const clamped = normalizeReport({ happened: "x".repeat(MAX_HAPPENED + 50) });
  ok(
    clamped.happened.length === MAX_HAPPENED,
    "clamps the narrative to MAX_HAPPENED",
  );
  ok(
    normalizeReport({}).happened === "",
    "missing narrative normalizes to empty string",
  );
  const longField = normalizeReport({
    happened: "ok",
    reaction: "y".repeat(MAX_FIELD + 10),
  });
  ok(
    longField.reaction?.length === MAX_FIELD,
    "clamps an optional field to MAX_FIELD",
  );

  console.log("\n# hasNarrative");
  ok(hasNarrative({ happened: "something" }), "true when narrative present");
  ok(!hasNarrative({ happened: "   " }), "false when narrative blank");

  console.log("\n# assembleReportNarration");
  const text = assembleReportNarration(ctx().report);
  ok(
    text.includes("WHAT HAPPENED") && text.includes("Got Dana on the phone"),
    "includes the labeled narrative",
  );
  ok(
    text.indexOf("WHAT THE REP SET OUT TO DO") <
      text.indexOf("WHAT HAPPENED"),
    "fields are in prompt order (objective before happened)",
  );
  const sparse = assembleReportNarration({ happened: "just this" });
  ok(
    sparse.includes("just this") && !sparse.includes("HOW THE OTHER SIDE"),
    "omits empty optional fields from the narration",
  );
}

// ---------- Prompt + output contract ----------
{
  console.log("\n# system prompt (the reporter contract)");
  const sys = buildSystemPrompt().toLowerCase();
  ok(sys.includes("reporter"), "frames Critiq as a reporter");
  ok(
    sys.includes("not grading") ||
      sys.includes("not a score") ||
      sys.includes("not assigning a score"),
    "explicitly says it is NOT grading/scoring",
  );
  ok(
    sys.includes("not giving advice") || sys.includes("never advice") ||
      sys.includes("no advice"),
    "explicitly says it is NOT giving advice",
  );
  ok(sys.includes("never invent"), "carries the honesty / no-fabrication rule");
  ok(
    sys.includes("spin") && sys.includes("voss") && sys.includes("navarro"),
    "names the three pillars as the observational lens",
  );

  console.log("\n# output format spec");
  const spec = buildOutputFormatSpec();
  for (const field of [
    "recap",
    "observations",
    "commitments",
    "openQuestions",
    "summary",
  ]) {
    ok(spec.includes(field), `output spec names the \`${field}\` field`);
  }
  for (const lens of OBSERVATION_LENSES) {
    ok(spec.includes(lens), `output spec lists the \`${lens}\` lens`);
  }

  console.log("\n# user prompt");
  const user = buildUserPrompt(ctx());
  ok(user.includes("Riverside Contractors"), "includes the account name");
  ok(user.includes("Got Dana on the phone"), "includes the rep's report");
  ok(user.includes("Repeat buyer"), "includes the account summary when present");
  const cold = buildUserPrompt(ctx({ accountSummary: null }));
  ok(cold.includes("cold-start"), "cold-start account gets the no-history note");
}

// ---------- Request construction (cache layers) ----------
{
  console.log("\n# buildDebriefRequest");
  const req = buildDebriefRequest(ctx({ repProfile: null }));
  ok(req.model === DEBRIEF_MODEL, `model is ${DEBRIEF_MODEL}`);
  ok(req.thinking.type === "adaptive", "adaptive thinking on");
  ok(
    req.system.length === 1,
    "one cached system layer (methodology) when no rep profile",
  );
  ok(
    !!req.system[0].cache_control,
    "the methodology layer carries a cache breakpoint",
  );
  const withProfile = buildDebriefRequest(
    ctx({ repProfile: "THE REP YOU ARE COACHING: relationship-first." }),
  );
  ok(
    withProfile.system.length === 2,
    "two cached layers (methodology + rep profile) when profile present",
  );
  ok(
    withProfile.messages[0].role === "user" &&
      withProfile.messages[0].content.includes("Got Dana"),
    "the volatile report is the user message",
  );
}

// ---------- Parsing + normalization ----------
{
  console.log("\n# coerceLens");
  for (const lens of OBSERVATION_LENSES) {
    ok(coerceLens(lens) === lens, `keeps known lens \`${lens}\``);
  }
  ok(coerceLens("STRUCTURE") === "structure", "lowercases a known lens");
  ok(coerceLens("vibes") === "general", "unknown lens → general");
  ok(coerceLens(undefined) === "general", "missing lens → general");

  console.log("\n# parseDebriefJson");
  const parsed = parseDebriefJson({
    recap: "  they stalled on price  ",
    observations: [
      { note: "asked how the budget was set", lens: "structure" },
      "a bare string observation",
      { note: "", lens: "voss" }, // dropped (empty note)
      { note: "warm rapport", lens: "made-up" }, // lens → general
    ],
    commitments: ["send the cost sheet", "", 5],
    openQuestions: ["who is the decision maker"],
    summary: "price-stalled, follow-up set",
  });
  ok(parsed.recap === "they stalled on price", "trims recap");
  ok(parsed.observations.length === 3, "drops the empty-note observation");
  ok(
    parsed.observations[1].note === "a bare string observation" &&
      parsed.observations[1].lens === "general",
    "tolerates a bare-string observation (→ general lens)",
  );
  ok(
    parsed.observations[2].lens === "general",
    "coerces an unknown lens to general",
  );
  ok(
    parsed.commitments.length === 1 && parsed.commitments[0] === "send the cost sheet",
    "string list drops empties + non-strings",
  );
  const missing = parseDebriefJson({ recap: "only a recap" });
  ok(
    missing.observations.length === 0 &&
      missing.commitments.length === 0 &&
      missing.openQuestions.length === 0,
    "missing list fields default to []",
  );

  console.log("\n# extractJsonObject");
  ok(
    (extractJsonObject('```json\n{"recap":"x"}\n```') as { recap: string })
      ?.recap === "x",
    "strips a json code fence",
  );
  ok(
    (extractJsonObject('prose {"recap":"y"} trailing') as { recap: string })
      ?.recap === "y",
    "falls back to the outermost object span",
  );
  ok(extractJsonObject("no json here") === null, "returns null when unparseable");

  console.log("\n# extractDebriefFromResponse");
  const good = extractDebriefFromResponse({
    stop_reason: "end_turn",
    content: [
      { type: "thinking", text: "…" },
      {
        type: "text",
        text: JSON.stringify({
          recap: "they stalled on price",
          observations: [{ note: "asked a calibrated question", lens: "communication" }],
          commitments: ["send cost sheet"],
          openQuestions: [],
          summary: "follow-up set",
        }),
      },
    ],
  });
  ok(good.recap === "they stalled on price", "extracts a valid debrief");
  ok(good.observations[0].lens === "communication", "keeps the parsed lens");

  const throws = (fn: () => unknown): boolean => {
    try {
      fn();
      return false;
    } catch {
      return true;
    }
  };
  ok(
    throws(() => extractDebriefFromResponse({ stop_reason: "refusal" })),
    "refusal throws",
  );
  ok(
    throws(() =>
      extractDebriefFromResponse({
        stop_reason: "max_tokens",
        content: [{ type: "text", text: "{}" }],
      }),
    ),
    "max_tokens (truncation) throws",
  );
  ok(
    throws(() =>
      extractDebriefFromResponse({ stop_reason: "end_turn", content: [] }),
    ),
    "empty content throws",
  );
  ok(
    throws(() =>
      extractDebriefFromResponse({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "not json" }],
      }),
    ),
    "unparseable text throws",
  );
  ok(
    throws(() =>
      extractDebriefFromResponse({
        stop_reason: "end_turn",
        content: [
          {
            type: "text",
            text: JSON.stringify({ recap: "", observations: [] }),
          },
        ],
      }),
    ),
    "a debrief with no recap AND no observations is rejected",
  );
}

// ---------- Summary ----------
console.log("");
if (fails.length === 0) {
  console.log("✅ Phase 20 verification PASSED (all assertions).");
} else {
  console.log(`❌ Phase 20 verification FAILED — ${fails.length} assertion(s):`);
  for (const f of fails) console.log(`   - ${f}`);
  process.exit(1);
}
