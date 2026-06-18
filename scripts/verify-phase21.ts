/**
 * Phase 21 unit verification — the Coaching Output Layer, pure logic only (no
 * network, no DB). Imports the REAL app modules (no re-implementation, per the
 * standing rule). The real Claude round-trip + the coaching QUALITY are the runtime
 * gate Felix + the expert coach validate; the real-Postgres store/generate path is a
 * throwaway probe. This proves deterministically: the coaching prompt + output
 * contract (incl. the "coach, grounded, conservative" contract + the lens set + the
 * score-vs-no-score rendering), request construction (the two cache layers), the
 * score-snapshot shaping, and response parsing/normalization (priorities require an
 * action; reinforcements tolerate bare strings; lens coercion; empty-coaching
 * rejection).
 *
 * Run: pnpm tsx scripts/verify-phase21.ts
 */
import {
  buildSystemPrompt,
  buildOutputFormatSpec,
  buildUserPrompt,
} from "../src/lib/coaching/prompt";
import {
  COACHING_MODEL,
  buildCoachingRequest,
  coerceLens,
  extractJsonObject,
  extractCoachingFromResponse,
  parseCoachingJson,
} from "../src/lib/coaching/anthropic";
import { buildScoreInput } from "../src/lib/coaching/generate";
import { COACHING_LENSES } from "../src/lib/coaching/types";
import type { CoachingContext } from "../src/lib/coaching/types";

const fails: string[] = [];
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) fails.push(msg);
};
const throws = (fn: () => unknown): boolean => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};

function ctx(over: Partial<CoachingContext> = {}): CoachingContext {
  return {
    accountName: "Riverside Contractors",
    accountStage: "active",
    accountSummary: "Repeat buyer; price-sensitive; values durability.",
    debrief: {
      recap: "Dana raised price again; rep mentioned lifetime-cost.",
      observations: [
        { note: "asked how the budget was set", lens: "structure" },
        { note: "let a pause sit after the durability point", lens: "communication" },
      ],
      commitments: ["Rep sends the lifetime-cost sheet Friday."],
      openQuestions: ["Is the GM the real decision-maker?"],
      summary: "price-stalled, follow-up set",
    },
    score: null,
    repProfile: null,
    ...over,
  };
}

const scoreInput = {
  snapshot: {
    overall: 58,
    spin: 18,
    voss: 22,
    navarro: 18,
    partialJudgement: false,
  },
  strengths: ["Strong tactical empathy on the price objection."],
  improvements: ["Develop the implication of the coating failures."],
};

// ---------- System prompt (the coaching contract) ----------
{
  console.log("\n# system prompt (the coaching contract)");
  const sys = buildSystemPrompt().toLowerCase();
  ok(sys.includes("coach"), "frames Critiq as a coach");
  ok(
    sys.includes("allowed") || sys.includes("expected") || sys.includes("give advice"),
    "explicitly says it IS allowed/expected to advise (unlike the debrief)",
  );
  ok(
    sys.includes("never invent") || sys.includes("ground every"),
    "carries the honesty / grounding rule",
  );
  ok(
    sys.includes("1–3") || sys.includes("1-3") || sys.includes("fewer"),
    "asks for a small number of priorities (no padding)",
  );
  ok(
    sys.includes("spin") && sys.includes("voss") && sys.includes("navarro"),
    "names the three pillars as the coaching lens",
  );
  ok(
    sys.includes("scored") && sys.includes("not scored"),
    "handles both the scored and the un-scored path",
  );
}

// ---------- Output format spec ----------
{
  console.log("\n# output format spec");
  const spec = buildOutputFormatSpec();
  for (const field of ["priorities", "reinforce", "nextStep", "summary"]) {
    ok(spec.includes(field), `output spec names the \`${field}\` field`);
  }
  for (const lens of COACHING_LENSES) {
    ok(spec.includes(lens), `output spec lists the \`${lens}\` lens`);
  }
  ok(spec.includes("action"), "priorities carry a concrete action");
}

// ---------- User prompt (score vs no-score rendering) ----------
{
  console.log("\n# user prompt — no score");
  const noScore = buildUserPrompt(ctx());
  ok(noScore.includes("Riverside Contractors"), "includes the account name");
  ok(noScore.includes("asked how the budget was set"), "includes the observations");
  ok(noScore.includes("lifetime-cost sheet"), "includes the commitments");
  ok(noScore.includes("GM the real decision-maker"), "includes the open questions");
  ok(noScore.includes("Repeat buyer"), "includes the account summary when present");
  ok(
    noScore.includes("not recorded") && noScore.toLowerCase().includes("no three-pillar score"),
    "states there is no score (and not to invent one) on the un-scored path",
  );

  console.log("\n# user prompt — with score");
  const withScore = buildUserPrompt(ctx({ score: scoreInput }));
  ok(withScore.includes("58 / 100"), "renders the overall score");
  ok(
    withScore.includes("18 / 35") && withScore.includes("22 / 35") && withScore.includes("18 / 30"),
    "renders all three pillar scores out of their ceilings",
  );
  ok(
    withScore.includes("Develop the implication"),
    "passes the scorer's improvement notes to the coach",
  );
  ok(
    withScore.includes("tactical empathy"),
    "passes the scorer's strengths to the coach",
  );

  const cold = buildUserPrompt(ctx({ accountSummary: null }));
  ok(cold.includes("cold-start"), "cold-start account gets the no-history note");

  const partial = buildUserPrompt(
    ctx({
      score: { ...scoreInput, snapshot: { ...scoreInput.snapshot, partialJudgement: true } },
    }),
  );
  ok(partial.toLowerCase().includes("partial"), "flags a partial judgement to the coach");
}

// ---------- buildScoreInput (snapshot shaping) ----------
{
  console.log("\n# buildScoreInput");
  ok(buildScoreInput(null) === null, "null score row → null input");
  ok(
    buildScoreInput({
      status: "processing",
      overallScore: 50,
      spinScore: 10,
      vossScore: 20,
      navarroScore: 20,
      strengths: [],
      improvements: [],
      partialJudgement: false,
    }) === null,
    "a non-completed score row → null input",
  );
  const built = buildScoreInput({
    status: "completed",
    overallScore: 58,
    spinScore: 18,
    vossScore: 22,
    navarroScore: 18,
    strengths: ["good empathy", "", 5 as unknown as string],
    improvements: ["develop implication"],
    partialJudgement: true,
  });
  ok(built?.snapshot.overall === 58, "carries the overall score");
  ok(
    built?.snapshot.spin === 18 &&
      built?.snapshot.voss === 22 &&
      built?.snapshot.navarro === 18,
    "carries the pillar scores",
  );
  ok(built?.snapshot.partialJudgement === true, "carries the partial flag");
  ok(
    built?.strengths.length === 1 && built?.strengths[0] === "good empathy",
    "cleans the strengths list (drops empties/non-strings)",
  );
  const nullCols = buildScoreInput({
    status: "completed",
    overallScore: null,
    spinScore: null,
    vossScore: null,
    navarroScore: null,
    strengths: null,
    improvements: null,
    partialJudgement: false,
  });
  ok(
    nullCols?.snapshot.overall === 0 && nullCols?.strengths.length === 0,
    "null score columns default to 0 / [] (never NaN/throw)",
  );
}

// ---------- Request construction (cache layers) ----------
{
  console.log("\n# buildCoachingRequest");
  const req = buildCoachingRequest(ctx({ repProfile: null }));
  ok(req.model === COACHING_MODEL, `model is ${COACHING_MODEL}`);
  ok(req.thinking.type === "adaptive", "adaptive thinking on");
  ok(
    req.system.length === 1,
    "one cached system layer (methodology) when no rep profile",
  );
  ok(!!req.system[0].cache_control, "the methodology layer carries a cache breakpoint");
  const withProfile = buildCoachingRequest(
    ctx({ repProfile: "THE REP YOU ARE COACHING: relationship-first." }),
  );
  ok(
    withProfile.system.length === 2,
    "two cached layers (methodology + rep profile) when profile present",
  );
  ok(
    withProfile.messages[0].role === "user" &&
      withProfile.messages[0].content.includes("Riverside"),
    "the volatile debrief is the user message",
  );
}

// ---------- Parsing + normalization ----------
{
  console.log("\n# coerceLens");
  for (const lens of COACHING_LENSES) {
    ok(coerceLens(lens) === lens, `keeps known lens \`${lens}\``);
  }
  ok(coerceLens("STRUCTURE") === "structure", "lowercases a known lens");
  ok(coerceLens("vibes") === "general", "unknown lens → general");
  ok(coerceLens(undefined) === "general", "missing lens → general");

  console.log("\n# parseCoachingJson");
  const parsed = parseCoachingJson({
    priorities: [
      { focus: "Develop the implication", lens: "structure", action: "Ask what the failed coatings cost in rework." },
      { lens: "communication", action: "Label the price worry: 'it seems like budget is the real blocker.'" }, // no focus → focus = action
      { focus: "no action here", lens: "structure" }, // dropped (no action)
      { focus: "bad lens", lens: "made-up", action: "do the thing" }, // lens → general
    ],
    reinforce: [
      { focus: "Tactical empathy", lens: "communication", note: "defused the price tension" },
      "kept a calm pace", // bare string tolerated
      { note: "", focus: "" }, // dropped
    ],
    nextStep: "  Send the lifetime-cost sheet Friday and confirm the GM.  ",
    summary: "price-stalled; develop implications next time",
  });
  ok(parsed.priorities.length === 3, "drops a priority with no action");
  ok(
    parsed.priorities[1].focus === parsed.priorities[1].action,
    "a priority with no focus falls back to its action as the label",
  );
  ok(parsed.priorities[2].lens === "general", "coerces an unknown priority lens to general");
  ok(parsed.reinforce.length === 2, "drops an empty reinforcement");
  ok(
    parsed.reinforce[1].focus === "kept a calm pace" &&
      parsed.reinforce[1].lens === "general",
    "tolerates a bare-string reinforcement (→ general lens)",
  );
  ok(
    parsed.nextStep === "Send the lifetime-cost sheet Friday and confirm the GM.",
    "trims the next step",
  );

  const missing = parseCoachingJson({ nextStep: "just a next step" });
  ok(
    missing.priorities.length === 0 && missing.reinforce.length === 0,
    "missing list fields default to []",
  );

  console.log("\n# extractJsonObject");
  ok(
    (extractJsonObject('```json\n{"nextStep":"x"}\n```') as { nextStep: string })
      ?.nextStep === "x",
    "strips a json code fence",
  );
  ok(
    (extractJsonObject('prose {"nextStep":"y"} trailing') as { nextStep: string })
      ?.nextStep === "y",
    "falls back to the outermost object span",
  );
  ok(extractJsonObject("no json here") === null, "returns null when unparseable");

  console.log("\n# extractCoachingFromResponse");
  const good = extractCoachingFromResponse({
    stop_reason: "end_turn",
    content: [
      { type: "thinking", text: "…" },
      {
        type: "text",
        text: JSON.stringify({
          priorities: [
            { focus: "Develop implication", lens: "structure", action: "ask what failures cost" },
          ],
          reinforce: [],
          nextStep: "send the sheet Friday",
          summary: "follow-up set",
        }),
      },
    ],
  });
  ok(good.priorities[0].lens === "structure", "extracts valid coaching + keeps the lens");
  ok(good.nextStep === "send the sheet Friday", "extracts the next step");

  ok(
    throws(() => extractCoachingFromResponse({ stop_reason: "refusal" })),
    "refusal throws",
  );
  ok(
    throws(() =>
      extractCoachingFromResponse({
        stop_reason: "max_tokens",
        content: [{ type: "text", text: "{}" }],
      }),
    ),
    "max_tokens (truncation) throws",
  );
  ok(
    throws(() =>
      extractCoachingFromResponse({ stop_reason: "end_turn", content: [] }),
    ),
    "empty content throws",
  );
  ok(
    throws(() =>
      extractCoachingFromResponse({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "not json" }],
      }),
    ),
    "unparseable text throws",
  );
  ok(
    throws(() =>
      extractCoachingFromResponse({
        stop_reason: "end_turn",
        content: [
          { type: "text", text: JSON.stringify({ priorities: [], nextStep: "" }) },
        ],
      }),
    ),
    "coaching with no priorities AND no next step is rejected",
  );
  // But coaching with a next step and no priorities (a thin-but-usable case) is OK.
  const thin = extractCoachingFromResponse({
    stop_reason: "end_turn",
    content: [
      {
        type: "text",
        text: JSON.stringify({
          priorities: [],
          reinforce: [],
          nextStep: "follow up Monday",
          summary: "",
        }),
      },
    ],
  });
  ok(
    thin.nextStep === "follow up Monday",
    "coaching with only a next step is accepted (thin but usable)",
  );
}

// ---------- Summary ----------
console.log("");
if (fails.length === 0) {
  console.log("✅ Phase 21 verification PASSED (all assertions).");
} else {
  console.log(`❌ Phase 21 verification FAILED — ${fails.length} assertion(s):`);
  for (const f of fails) console.log(`   - ${f}`);
  process.exit(1);
}
