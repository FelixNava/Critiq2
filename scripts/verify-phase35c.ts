/**
 * Phase 35c unit verification — wiring Phase 25 working memory + Phase 35a context into the
 * four AI consumers (pre-call 18 / script 19 / debrief 20 / coaching 21). PURE: no DB, no
 * network. Imports the REAL app modules (no re-implementation, per the standing rule).
 *
 * What this proves deterministically:
 *   1. renderAccountKnowledge precedence — memory context → bare summary → cold-start note,
 *      and that the cold-start fallback is byte-identical to the pre-35c inline string (so the
 *      consumer prompts are unchanged whenever no memory was assembled).
 *   2. All FOUR consumers' user prompts honor `memoryContext`: when present it appears and the
 *      cold-start note does NOT; when absent the summary / cold-start behaviour is unchanged.
 *   3. The cache split is intact — each consumer still places the rep profile as the per-rep
 *      cached SYSTEM layer (buildCachedSystem layer 2), while the memory context is volatile
 *      (in the user message, never in `system`).
 *
 * The DB-backed adapter (buildConsumerWorkingMemory) + the full generate→guard path are
 * exercised by a throwaway real-Postgres / real-Claude probe (not committed), mirroring the
 * Phase 25 posture.
 *
 * Run: pnpm tsx scripts/verify-phase35c.ts
 */
import {
  COLD_START_ACCOUNT_NOTE,
  renderAccountKnowledge,
} from "../src/lib/workingmemory/consumerPrompt";
import { buildUserPrompt as buildBriefUserPrompt } from "../src/lib/precall/prompt";
import { buildBriefRequest } from "../src/lib/precall/anthropic";
import { buildUserPrompt as buildScriptUserPrompt } from "../src/lib/script/prompt";
import { buildScriptRequest } from "../src/lib/script/anthropic";
import { buildUserPrompt as buildDebriefUserPrompt } from "../src/lib/debrief/prompt";
import { buildDebriefRequest } from "../src/lib/debrief/anthropic";
import { buildUserPrompt as buildCoachingUserPrompt } from "../src/lib/coaching/prompt";
import { buildCoachingRequest } from "../src/lib/coaching/anthropic";
import type { BriefContext } from "../src/lib/precall/types";
import type { ScriptContext } from "../src/lib/script/types";
import type { DebriefContext } from "../src/lib/debrief/types";
import type { CoachingContext } from "../src/lib/coaching/types";

const fails: string[] = [];
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) fails.push(msg);
};

const MEM = "MEMORY CONTEXT BLOCK — recent interactions + rep/account context";
const SUMMARY = "Shared running summary narrative for the account.";

// ---------------------------------------------------------------------------
console.log("\n## renderAccountKnowledge — precedence + byte-identical fallback");
// ---------------------------------------------------------------------------
ok(renderAccountKnowledge(MEM, SUMMARY) === MEM, "memory context wins when present");
ok(renderAccountKnowledge("   ", SUMMARY) === SUMMARY, "whitespace-only memory falls back to summary");
ok(renderAccountKnowledge(null, SUMMARY) === SUMMARY, "no memory → bare summary (pre-35c behaviour)");
ok(renderAccountKnowledge(undefined, SUMMARY) === SUMMARY, "undefined memory → bare summary");
ok(
  renderAccountKnowledge(null, "  " + SUMMARY + "  ") === SUMMARY,
  "summary is trimmed exactly as the consumers did inline",
);
ok(renderAccountKnowledge(null, null) === COLD_START_ACCOUNT_NOTE, "no memory + no summary → cold-start note");
ok(renderAccountKnowledge(null, "   ") === COLD_START_ACCOUNT_NOTE, "blank summary → cold-start note");
ok(
  COLD_START_ACCOUNT_NOTE === "(nothing yet — this is a cold-start account with no logged history)",
  "cold-start note is byte-identical to the pre-35c inline string (no prompt drift)",
);

// ---------------------------------------------------------------------------
// Minimal valid contexts for each consumer (only the fields the user prompt reads).
// ---------------------------------------------------------------------------
const briefCtx = (over: Partial<BriefContext> = {}): BriefContext => ({
  accountName: "Acme Coatings",
  accountStage: "active",
  accountSummary: SUMMARY,
  narration: "Following up after the walkthrough.",
  interactionNumber: 4,
  objectiveMode: "signal",
  repObjective: null,
  repProfile: "REP PROFILE BLOCK",
  ...over,
});

const scriptCtx = (over: Partial<ScriptContext> = {}): ScriptContext => ({
  accountName: "Acme Coatings",
  accountStage: "active",
  accountSummary: SUMMARY,
  objective: "Secure a product trial",
  diagnosis: "Price-sensitive but loyal.",
  approach: [{ focus: "Surface the cost of downtime", why: "Implication" }],
  objections: [{ objection: "Too expensive", response: "Anchor on total cost" }],
  styleMode: "relational",
  repProfile: "REP PROFILE BLOCK",
  ...over,
});

const debriefCtx = (over: Partial<DebriefContext> = {}): DebriefContext => ({
  accountName: "Acme Coatings",
  accountStage: "active",
  accountSummary: SUMMARY,
  report: { happened: "We discussed the repaint timeline." },
  repProfile: "REP PROFILE BLOCK",
  ...over,
});

const coachingCtx = (over: Partial<CoachingContext> = {}): CoachingContext => ({
  accountName: "Acme Coatings",
  accountStage: "active",
  accountSummary: SUMMARY,
  debrief: {
    recap: "The rep walked the buyer through options.",
    observations: [{ note: "Asked about budget", lens: "structure" }],
    commitments: ["Send a quote"],
    openQuestions: ["Who signs off?"],
    summary: "Solid discovery call.",
  },
  score: null,
  repProfile: "REP PROFILE BLOCK",
  ...over,
});

const consumers: {
  name: string;
  withMem: string;
  withSummary: string;
  cold: string;
  systemHasRep: boolean;
  systemHasMem: boolean;
}[] = [
  {
    name: "pre-call",
    withMem: buildBriefUserPrompt(briefCtx({ memoryContext: MEM })),
    withSummary: buildBriefUserPrompt(briefCtx()),
    cold: buildBriefUserPrompt(briefCtx({ accountSummary: null })),
    systemHasRep: buildBriefRequest(briefCtx({ memoryContext: MEM })).system.some((b) =>
      b.text.includes("REP PROFILE BLOCK"),
    ),
    systemHasMem: buildBriefRequest(briefCtx({ memoryContext: MEM })).system.some((b) =>
      b.text.includes(MEM),
    ),
  },
  {
    name: "script",
    withMem: buildScriptUserPrompt(scriptCtx({ memoryContext: MEM })),
    withSummary: buildScriptUserPrompt(scriptCtx()),
    cold: buildScriptUserPrompt(scriptCtx({ accountSummary: null })),
    systemHasRep: buildScriptRequest(scriptCtx({ memoryContext: MEM })).system.some((b) =>
      b.text.includes("REP PROFILE BLOCK"),
    ),
    systemHasMem: buildScriptRequest(scriptCtx({ memoryContext: MEM })).system.some((b) =>
      b.text.includes(MEM),
    ),
  },
  {
    name: "debrief",
    withMem: buildDebriefUserPrompt(debriefCtx({ memoryContext: MEM })),
    withSummary: buildDebriefUserPrompt(debriefCtx()),
    cold: buildDebriefUserPrompt(debriefCtx({ accountSummary: null })),
    systemHasRep: buildDebriefRequest(debriefCtx({ memoryContext: MEM })).system.some((b) =>
      b.text.includes("REP PROFILE BLOCK"),
    ),
    systemHasMem: buildDebriefRequest(debriefCtx({ memoryContext: MEM })).system.some((b) =>
      b.text.includes(MEM),
    ),
  },
  {
    name: "coaching",
    withMem: buildCoachingUserPrompt(coachingCtx({ memoryContext: MEM })),
    withSummary: buildCoachingUserPrompt(coachingCtx()),
    cold: buildCoachingUserPrompt(coachingCtx({ accountSummary: null })),
    systemHasRep: buildCoachingRequest(coachingCtx({ memoryContext: MEM })).system.some((b) =>
      b.text.includes("REP PROFILE BLOCK"),
    ),
    systemHasMem: buildCoachingRequest(coachingCtx({ memoryContext: MEM })).system.some((b) =>
      b.text.includes(MEM),
    ),
  },
];

// ---------------------------------------------------------------------------
console.log("\n## All four consumers honor memoryContext uniformly");
// ---------------------------------------------------------------------------
for (const c of consumers) {
  ok(c.withMem.includes(MEM), `${c.name}: memory context appears in the user prompt when present`);
  ok(
    !c.withMem.includes(COLD_START_ACCOUNT_NOTE),
    `${c.name}: memory context supersedes the cold-start note`,
  );
  ok(
    c.withSummary.includes(SUMMARY) && !c.withSummary.includes(MEM),
    `${c.name}: no memory → the bare shared summary is used (pre-35c behaviour)`,
  );
  ok(
    c.cold.includes(COLD_START_ACCOUNT_NOTE),
    `${c.name}: no memory + no summary → the cold-start note`,
  );
  // Cache split: rep profile stays in the cached SYSTEM layer; memory context is VOLATILE only.
  ok(c.systemHasRep, `${c.name}: rep profile remains a cached SYSTEM layer (cache split intact)`);
  ok(
    !c.systemHasMem,
    `${c.name}: memory context is VOLATILE — never placed in the cached system layers`,
  );
}

// ---------------------------------------------------------------------------
console.log("\n=========================================");
if (fails.length === 0) {
  console.log("✅ Phase 35c verification PASSED — all assertions green.");
} else {
  console.log(`❌ Phase 35c verification FAILED — ${fails.length} assertion(s):`);
  for (const f of fails) console.log(`   - ${f}`);
  process.exit(1);
}
