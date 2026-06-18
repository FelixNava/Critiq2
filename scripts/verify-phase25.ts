/**
 * Phase 25 unit verification — working memory assembly (the WORKING tier). Pure: no DB, no
 * network. Imports the REAL app modules (no re-implementation, per the standing rule). The
 * DB-backed builder (build.ts/sources.ts) + the access boundary are exercised by a throwaway
 * real-Postgres probe (not committed); this proves the methodology block, the token-budget
 * primitives, the formatters, and the assembler's budget/trim/cache-split policy across all
 * branches — deterministically.
 *
 * Run: pnpm tsx scripts/verify-phase25.ts
 */
import { buildMethodologyBlock } from "../src/lib/workingmemory/methodology";
import {
  CHARS_PER_TOKEN,
  DEFAULT_WORKING_MEMORY_BUDGET,
  DEFAULT_MAX_RAW_INTERACTIONS,
  MIN_USEFUL_TOKENS,
  TRUNCATION_MARKER,
  estimateTokens,
  truncateToTokens,
} from "../src/lib/workingmemory/budget";
import { assembleWorkingMemory } from "../src/lib/workingmemory/assemble";
import {
  formatRepProfileFromSummary,
  formatAccountSummaryBlock,
  formatRawInteraction,
} from "../src/lib/workingmemory/format";
import type {
  RawInteraction,
  WorkingMemorySources,
} from "../src/lib/workingmemory/types";
import type { AccountSummary, RepSummary } from "../src/db/schema";
import { DIMENSIONS, PILLARS } from "../src/lib/scoring/rubric";

const fails: string[] = [];
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) fails.push(msg);
};

// Build a string whose trimmed length is exactly `tokens * CHARS_PER_TOKEN` → estimateTokens === tokens.
const tok = (tokens: number, fill = "x"): string => fill.repeat(tokens * CHARS_PER_TOKEN);

function rawInteraction(over: Partial<RawInteraction> = {}): RawInteraction {
  return {
    debriefId: over.debriefId ?? "d1",
    occurredAt: over.occurredAt ?? new Date("2026-06-01T12:00:00Z"),
    report: over.report ?? { happened: "we talked about the repaint job" },
  };
}

function baseSources(over: Partial<WorkingMemorySources> = {}): WorkingMemorySources {
  // Spread (NOT `?? default`) so an explicit `null` override is respected, not clobbered.
  return {
    methodology: "METHODOLOGY",
    repProfile: "REP PROFILE",
    repProfileSource: "learned",
    accountSummary: "ACCOUNT SUMMARY",
    rawInteractions: [rawInteraction()],
    olderInteractionsOmitted: 0,
    ...over,
  };
}

// ---------------------------------------------------------------------------
console.log("\n## Methodology block (derived from the rubric, single source of truth)");
// ---------------------------------------------------------------------------
const methodology = buildMethodologyBlock();
ok(methodology.includes("Critiq"), "methodology names Critiq + the coaching role");
ok(
  Object.values(PILLARS).every((p) => methodology.includes(p.name)),
  "methodology includes every pillar name (SPIN/Voss/Navarro)",
);
ok(
  DIMENSIONS.every((d) => methodology.includes(d.name)),
  "methodology includes every sub-dimension name (drift-proof from the rubric)",
);
ok(methodology.includes("100 points"), "methodology states the 100-point total");
ok(
  methodology.toLowerCase().includes("grounding"),
  "methodology carries the grounding rule (sets up Phase 26)",
);
ok(
  !methodology.includes("OUTPUT FORMAT") && !methodology.includes("JSON"),
  "methodology carries NO scoring-specific output contract (shared layer, many consumers)",
);
const methodology2 = buildMethodologyBlock();
ok(methodology === methodology2, "methodology block is deterministic (byte-stable → caches)");

// ---------------------------------------------------------------------------
console.log("\n## Token budget primitives");
// ---------------------------------------------------------------------------
ok(estimateTokens("") === 0, "estimateTokens('') === 0");
ok(estimateTokens("   ") === 0, "estimateTokens(whitespace) === 0");
ok(estimateTokens(tok(10)) === 10, "estimateTokens counts ~4 chars/token");
ok(estimateTokens("abcde") === 2, "estimateTokens rounds UP (never under-counts)");

const longText = "word ".repeat(500); // ~2500 chars
const trimmed = truncateToTokens(longText, 50);
ok(estimateTokens(trimmed) <= 50, "truncateToTokens respects the token ceiling");
ok(trimmed.endsWith(TRUNCATION_MARKER), "truncateToTokens appends the truncation marker");
ok(
  truncateToTokens("short text", 1000) === "short text",
  "truncateToTokens returns text unchanged when it already fits",
);
ok(truncateToTokens(longText, 0) === "", "truncateToTokens(_, 0) drops the block");
ok(
  truncateToTokens(longText, estimateTokens(TRUNCATION_MARKER)) === "",
  "truncateToTokens drops when there's no room for a body past the marker",
);

// ---------------------------------------------------------------------------
console.log("\n## Assembler — happy path (everything fits)");
// ---------------------------------------------------------------------------
const wm = assembleWorkingMemory(baseSources());
ok(wm.stableLayers.length === 2, "stable layers = methodology + rep profile");
ok(wm.stableLayers[0].text === "METHODOLOGY", "methodology is the FIRST stable layer (cache order)");
ok(wm.stableLayers[1].text === "REP PROFILE", "rep profile is the SECOND stable layer");
ok(
  wm.volatileContext.includes("ACCOUNT SUMMARY"),
  "account summary is in the volatile context (not cached)",
);
ok(
  wm.volatileContext.includes("RECENT INTERACTIONS WITH THIS ACCOUNT"),
  "raw interactions are in the volatile context under a header",
);
ok(
  !wm.volatileContext.includes("METHODOLOGY") && !wm.volatileContext.includes("REP PROFILE"),
  "stable layers are NOT duplicated into the volatile context",
);
ok(wm.manifest.rawInteractionsIncluded === 1, "manifest counts the included raw interaction");
ok(wm.manifest.withinBudget, "manifest: within budget on the happy path");
ok(wm.manifest.repProfileSource === "learned", "manifest passes through repProfileSource");
ok(wm.manifest.tokenBudget === DEFAULT_WORKING_MEMORY_BUDGET, "manifest reports the default budget");
ok(
  wm.manifest.layers.find((l) => l.name === "methodology")?.included === true,
  "manifest layer: methodology included",
);

// ---------------------------------------------------------------------------
console.log("\n## Assembler — rep profile is always kept; cold-start variants");
// ---------------------------------------------------------------------------
const noRep = assembleWorkingMemory(
  baseSources({ repProfile: null, repProfileSource: "none" }),
);
ok(noRep.stableLayers.length === 1, "no rep profile → only the methodology stable layer");
ok(noRep.stableLayers[0].text === "METHODOLOGY", "methodology still present with no rep profile");
ok(
  noRep.manifest.layers.find((l) => l.name === "repProfile")?.included === false,
  "manifest layer: repProfile not included at cold start",
);

const coldAccount = assembleWorkingMemory(
  baseSources({ accountSummary: null, rawInteractions: [], olderInteractionsOmitted: 0 }),
);
ok(coldAccount.volatileContext === "", "cold-start account → empty volatile context");
ok(coldAccount.manifest.accountSummaryIncluded === false, "manifest: no account summary at cold start");
ok(coldAccount.manifest.rawInteractionsIncluded === 0, "manifest: no raw interactions at cold start");

// ---------------------------------------------------------------------------
console.log("\n## Assembler — budget squeeze drops raw interactions newest-first");
// ---------------------------------------------------------------------------
// Methodology(50) + rep(50) reserved = 100. Budget 225 → volatile 125. Account(20) leaves 105.
// Raw header (~15) reserved → ~90 for blocks of ~67 tokens each: only the newest fits (67 ≤ 90);
// the next needs 67 but only ~23 remain (< MIN_USEFUL) → dropped.
const bigRaw = (id: string): RawInteraction =>
  rawInteraction({ debriefId: id, report: { happened: tok(55) } });
const squeezed = assembleWorkingMemory(
  baseSources({
    methodology: tok(50),
    repProfile: tok(50),
    accountSummary: tok(20),
    rawInteractions: [bigRaw("newest"), bigRaw("mid"), bigRaw("oldest")],
  }),
  { tokenBudget: 225 },
);
ok(squeezed.manifest.accountSummaryIncluded, "squeeze: account summary kept (outranks raw tail)");
ok(
  squeezed.manifest.rawInteractionsIncluded === 1,
  "squeeze: only the newest raw interaction fits",
);
ok(
  squeezed.manifest.rawInteractionsDropped === 2,
  "squeeze: the two older raw interactions are dropped (counted, not silent)",
);
ok(
  squeezed.volatileContext.includes("Interaction 1"),
  "squeeze: the kept raw interaction is labeled Interaction 1 (newest)",
);

// ---------------------------------------------------------------------------
console.log("\n## Assembler — account summary truncates under pressure; raw drops first");
// ---------------------------------------------------------------------------
// Reserved 100, budget 380 → volatile 280. Account 120 fits (leaves 160). Raw header (~15)
// reserved → ~145 ≥ MIN_USEFUL; the ~210-token raw doesn't fit → truncated, not dropped.
const trunc = assembleWorkingMemory(
  baseSources({
    methodology: tok(50),
    repProfile: tok(50),
    accountSummary: tok(120),
    rawInteractions: [rawInteraction({ report: { happened: tok(200) } })],
  }),
  { tokenBudget: 380 },
);
ok(trunc.manifest.accountSummaryIncluded && !trunc.manifest.accountSummaryTruncated,
  "account summary fits fully when there's room");
ok(trunc.manifest.rawInteractionsIncluded === 1 && trunc.manifest.rawInteractionsTruncated === 1,
  "the partial-room raw interaction is truncated, not dropped");

// Now starve the account summary: reserved 100, budget 140 → volatile 40 (< MIN_USEFUL) → account dropped.
const starve = assembleWorkingMemory(
  baseSources({
    methodology: tok(50),
    repProfile: tok(50),
    accountSummary: tok(200),
    rawInteractions: [rawInteraction({ report: { happened: tok(200) } })],
  }),
  { tokenBudget: 140 },
);
ok(!starve.manifest.accountSummaryIncluded, "account summary dropped when volatile budget < MIN_USEFUL");
ok(starve.manifest.rawInteractionsIncluded === 0, "raw interactions dropped when no room remains");
ok(starve.stableLayers.length === 2, "foundation (methodology + rep) is NEVER dropped, even when starved");

// ---------------------------------------------------------------------------
console.log("\n## Assembler — foundation exceeding the budget reports overflow honestly");
// ---------------------------------------------------------------------------
const overflow = assembleWorkingMemory(
  baseSources({ methodology: tok(500), repProfile: tok(500), accountSummary: null, rawInteractions: [] }),
  { tokenBudget: 300 },
);
ok(!overflow.manifest.withinBudget, "withinBudget=false when methodology+rep alone exceed the budget");
ok(overflow.stableLayers.length === 2, "foundation still emitted even when it overflows the budget");

// ---------------------------------------------------------------------------
console.log("\n## Assembler — honors maxRawInteractions + exact token accounting (review fixes)");
// ---------------------------------------------------------------------------
const capped = assembleWorkingMemory(
  baseSources({
    rawInteractions: [
      rawInteraction({ debriefId: "a" }),
      rawInteraction({ debriefId: "b" }),
      rawInteraction({ debriefId: "c" }),
    ],
  }),
  { maxRawInteractions: 1 },
);
ok(capped.manifest.rawInteractionsIncluded === 1, "assembler honors maxRawInteractions (caps to 1)");
ok(capped.manifest.rawInteractionsDropped === 2, "assembler discloses the 2 capped-out interactions (no silent cap)");

// estimatedTokens must equal stable-layer estimates + the ACTUAL volatile text (so the
// raw-section header + separators are counted — the undercount the review caught).
const counted = assembleWorkingMemory(baseSources());
const expectStable = counted.stableLayers.reduce((n, l) => n + estimateTokens(l.text), 0);
ok(
  counted.manifest.estimatedTokens === expectStable + estimateTokens(counted.volatileContext),
  "estimatedTokens counts the actual emitted text (header + separators included)",
);
ok(
  counted.volatileContext.includes("RECENT INTERACTIONS") &&
    estimateTokens(counted.volatileContext) >= estimateTokens("RECENT INTERACTIONS WITH THIS ACCOUNT (most recent first):"),
  "the raw-section header is part of the costed volatile text",
);

// ---------------------------------------------------------------------------
console.log("\n## Assembler — older-than-cap omissions fold into 'dropped'");
// ---------------------------------------------------------------------------
const withOlder = assembleWorkingMemory(
  baseSources({ rawInteractions: [rawInteraction()], olderInteractionsOmitted: 7 }),
);
ok(
  withOlder.manifest.rawInteractionsDropped === 7,
  "older-than-cap omissions are counted in rawInteractionsDropped (no silent cap)",
);
ok(DEFAULT_MAX_RAW_INTERACTIONS === 3, "the locked default carries the last 3 raw interactions");
ok(MIN_USEFUL_TOKENS > 0, "MIN_USEFUL_TOKENS floor is positive");

// ---------------------------------------------------------------------------
console.log("\n## Formatters");
// ---------------------------------------------------------------------------
const repSummary = {
  headline: "Strong rapport-builder; under-develops implications.",
  narrative: "This rep opens warm and earns trust quickly.",
  traits: [
    { text: "Moves to next steps before quantifying the cost of the problem", lens: "structure", sourceDebriefId: "x" },
    { text: "Excellent at labeling buyer emotion", lens: "communication", sourceDebriefId: "y" },
    { text: "  ", lens: "general", sourceDebriefId: "z" }, // empty → dropped
  ],
} as unknown as RepSummary;
const repBlock = formatRepProfileFromSummary(repSummary);
ok(repBlock != null && repBlock.includes("learned profile"), "rep profile block labels itself a learned profile");
ok(repBlock!.includes("Excellent at labeling buyer emotion"), "rep profile renders traits");
ok(!repBlock!.includes("sourceDebriefId") && !repBlock!.includes('"x"'), "rep profile hides internal source ids");
ok(
  (repBlock!.match(/ - /g) ?? []).length === 2,
  "rep profile drops the empty-text trait (defensive coerce)",
);
ok(
  formatRepProfileFromSummary({ headline: null, narrative: null, traits: null } as unknown as RepSummary) === null,
  "rep profile returns null when there's nothing usable (caller falls back to intake)",
);

const acctSummary = {
  headline: "Active account, budget approved through Q3.",
  narrative: "Long-time buyer; values reliability over price.",
  facts: [{ text: "Budget approved through Q3", lens: "general", sourceDebriefId: "d1" }],
} as unknown as AccountSummary;
const acctBlock = formatAccountSummaryBlock(acctSummary, "Acme Coatings");
ok(acctBlock != null && acctBlock.includes("Acme Coatings"), "account block names the account");
ok(acctBlock!.includes("Budget approved through Q3"), "account block renders facts");
ok(!acctBlock!.includes("d1"), "account block hides internal source ids");

const rawBlock = formatRawInteraction(
  rawInteraction({
    occurredAt: new Date("2026-05-15T09:30:00Z"),
    report: { objective: "Re-open the relationship", happened: "Caught up over coffee", reaction: "Warm" },
  }),
  1,
);
ok(rawBlock.includes("Interaction 1 (2026-05-15)"), "raw interaction labels position + UTC date");
ok(rawBlock.includes("Objective:") && rawBlock.includes("How they reacted:"), "raw interaction renders present fields");
ok(!rawBlock.includes("Commitments"), "raw interaction omits empty optional fields");

// ---------------------------------------------------------------------------
console.log("\n=========================================");
if (fails.length === 0) {
  console.log(`✅ Phase 25 verification PASSED — all assertions green.`);
} else {
  console.log(`❌ Phase 25 verification FAILED — ${fails.length} assertion(s):`);
  for (const f of fails) console.log(`   - ${f}`);
  process.exit(1);
}
