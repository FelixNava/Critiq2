/**
 * Phase 26 unit verification — the Hallucination Guard. Pure: no DB, no network. Imports the
 * REAL app modules (no re-implementation, per the standing rule). The DB-backed corpus builder
 * (sources.ts) + the live Claude verifier are exercised by a throwaway real-PG + real-Claude
 * probe (not committed); this proves the detector, the deterministic grounding, the policy,
 * the verifier request/parse, the full guardOutput orchestration across every branch, and the
 * coaching adapter — deterministically, with a fake verifier.
 *
 * Run: pnpm tsx scripts/verify-phase26.ts
 */
import {
  detectPersonalReferences,
  groundReference,
  buildSearchCorpus,
} from "../src/lib/hallucinationguard/detect";
import {
  resolveAction,
  resolveGuardMode,
  DEFAULT_GUARD_MODE,
} from "../src/lib/hallucinationguard/policy";
import {
  guardOutput,
  formatGuardManifest,
} from "../src/lib/hallucinationguard/guard";
import {
  buildVerifierRequest,
  parseVerifierVerdicts,
  extractVerdictsFromResponse,
  GUARD_VERIFIER_MODEL,
} from "../src/lib/hallucinationguard/anthropic";
import { buildVerifierSystemPrompt } from "../src/lib/hallucinationguard/prompt";
import { guardCoachingResult } from "../src/lib/coaching/guard";
import type {
  GroundedSource,
  GuardVerifier,
  VerifierRequest,
  VerifierVerdict,
} from "../src/lib/hallucinationguard/types";
import type { CoachingResult } from "../src/lib/coaching/types";

const fails: string[] = [];
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) fails.push(msg);
};

const cats = (text: string) =>
  detectPersonalReferences(text).map((r) => `${r.category}:${r.span}`);
const spans = (text: string) => detectPersonalReferences(text).map((r) => r.span);

// A corpus stating: Bob Stevens (Park Avenue Paint) approved a $5,000 Q3 repaint, 27% margin.
const SOURCES: GroundedSource[] = [
  {
    id: "D1",
    kind: "raw-interaction",
    text:
      "Met Bob Stevens at Park Avenue Paint. He approved the $5,000 repaint budget for Q3 " +
      "and mentioned a 27% margin target. Follow up by 2026-07-15.",
  },
  { id: "D2", kind: "account-fact", text: "Decision maker is Bob Stevens." },
];

async function main() {
// ---------------------------------------------------------------------------
console.log("\n## Detector — high-precision categories");
// ---------------------------------------------------------------------------
ok(
  cats("Email bob@parkave.com about it").some((c) => c === "contact-detail:bob@parkave.com"),
  "detects an email as a contact-detail",
);
ok(
  cats("Call 555-123-4567 tomorrow").some((c) => c.startsWith("contact-detail:555")),
  "detects a phone number as a contact-detail",
);
ok(
  cats("The budget is $5,000 this quarter").some((c) => c === "money:$5,000"),
  "detects a dollar amount as money",
);
ok(
  cats("They want a 27% margin").some((c) => c === "number:27%"),
  "detects a percentage",
);
ok(
  cats("Follow up by 2026-07-15").some((c) => c === "date:2026-07-15"),
  "detects an ISO date",
);
ok(cats("Close it in Q3").some((c) => c === "date:Q3"), "detects a quarter (Q3)");
ok(
  cats("Send it by July 15").some((c) => c.startsWith("date:July")),
  "detects a month-name date",
);
ok(spans("$5,000").length === 1, "money span is not double-counted as a bare number (de-overlap)");

// ---------------------------------------------------------------------------
console.log("\n## Detector — names vs methodology (the false-positive guard)");
// ---------------------------------------------------------------------------
ok(
  spans("Talk to Bob Stevens").includes("Bob Stevens"),
  "detects a multi-word person name",
);
ok(
  cats("Park Avenue Paint is the account").some((c) => c.startsWith("org-name:Park Avenue Paint")),
  "classifies an org (has 'Paint' marker) as org-name",
);
ok(
  spans("Ask Dana about the timeline") .includes("Dana") &&
    !spans("Ask Dana about the timeline").includes("Ask Dana"),
  "trims the leading stopword verb: 'Ask Dana' → 'Dana'",
);
ok(
  detectPersonalReferences(
    "Develop the implication and ask a calibrated question (SPIN, Voss, Navarro).",
  ).length === 0,
  "ignores pure methodology language — SPIN/Voss/Navarro + technique are not personal refs",
);
ok(
  detectPersonalReferences("Lead with curiosity and listen for the problem.").length === 0,
  "ignores generic coaching verbs/nouns (no false-positive names)",
);

// ---------------------------------------------------------------------------
console.log("\n## Deterministic grounding");
// ---------------------------------------------------------------------------
const corpus = buildSearchCorpus(SOURCES);
const g = (span: string, category: Parameters<typeof groundReference>[0]["category"]) =>
  groundReference({ span, category }, corpus);
ok(g("Bob Stevens", "person-name").grounded, "grounds a name present in the corpus");
ok(g("Bob Stevens", "person-name").sourceId === "D1", "returns the originating source id");
ok(!g("Dana Klein", "person-name").grounded, "does NOT ground a name absent from the corpus");
ok(g("$5,000", "money").grounded, "grounds money by digit-core ($5,000 → 5000)");
ok(!g("$9,999", "money").grounded, "does NOT ground a money amount absent from the corpus");
ok(g("27%", "number").grounded, "grounds a percentage present in the corpus");
ok(g("Q3", "date").grounded, "grounds a quarter present in the corpus");
ok(!g("Q4", "date").grounded, "does NOT ground a quarter absent from the corpus");
ok(g("2026-07-15", "date").grounded, "grounds an ISO date present in the corpus");

// Exact-token numeric grounding (the fixed false-grounding bugs).
const corpus2 = buildSearchCorpus([
  { id: "X1", kind: "raw-interaction", text: "Their margin target is 127% of cost and the budget is $1,500." },
]);
const g2 = (span: string, c: Parameters<typeof groundReference>[0]["category"]) =>
  groundReference({ span, category: c }, corpus2);
ok(!g2("27%", "number").grounded, "27% is NOT falsely grounded by '127%' (exact-token match)");
ok(g2("127%", "number").grounded, "127% IS grounded by '127%'");
ok(!g2("$500", "money").grounded, "$500 is NOT falsely grounded by '$1,500' (exact-token match)");
ok(g2("$1,500", "money").grounded, "$1,500 IS grounded; magnitude/commas normalized");
// Cross-format date grounding (the fixed false-redaction bug).
const corpus3 = buildSearchCorpus([
  { id: "Y1", kind: "raw-interaction", text: "Follow up on 07/15/2026 about the order." },
]);
ok(
  groundReference({ span: "2026-07-15", category: "date" }, corpus3).grounded,
  "an ISO date grounds against the SAME date written 07/15/2026 (cross-format)",
);
// Account name grounding (the fixed false-redaction of the account's own name).
const corpus4 = buildSearchCorpus([
  { id: "account-name", kind: "account-summary", text: "Park Avenue Paint" },
]);
ok(
  groundReference({ span: "Park Avenue Paint", category: "org-name" }, corpus4).grounded,
  "the account's own name grounds against the account-name source",
);
// 2-digit quantity detection (the fixed small-number blind spot).
ok(
  cats("They ordered 85 gallons").some((c) => c === "number:85"),
  "detects a 2-digit quantity (85) — fabricated counts are now checked",
);

// ---------------------------------------------------------------------------
console.log("\n## Policy");
// ---------------------------------------------------------------------------
ok(resolveAction("conservative", false) === "redacted", "conservative redacts ungrounded");
ok(resolveAction("conservative", true) === "kept", "conservative keeps grounded");
ok(resolveAction("balanced", false) === "flagged", "balanced flags ungrounded (no strip)");
ok(resolveAction("off", false) === "kept", "off keeps everything (observe-only)");
ok(DEFAULT_GUARD_MODE === "conservative", "the locked default mode is conservative");
ok(resolveGuardMode("balanced") === "balanced", "resolveGuardMode honors a valid override");
ok(resolveGuardMode("nonsense") === "conservative", "resolveGuardMode falls back on a bad value");
ok(resolveGuardMode(undefined) === "conservative", "resolveGuardMode defaults to conservative");

// ---------------------------------------------------------------------------
console.log("\n## guardOutput — orchestration across branches (fake verifier)");
// ---------------------------------------------------------------------------

/** A fake verifier driven by a span→supported map (records whether it was called). */
class FakeVerifier implements GuardVerifier {
  calls = 0;
  lastRequest: VerifierRequest | null = null;
  constructor(private readonly support: Record<string, { supported: boolean; sourceId?: string }>) {}
  async verify(request: VerifierRequest): Promise<VerifierVerdict[]> {
    this.calls += 1;
    this.lastRequest = request;
    return request.suspects.map((s) => {
      const v = this.support[s.span];
      return {
        field: s.field,
        span: s.span,
        supported: v?.supported ?? false,
        sourceId: v?.supported ? v.sourceId ?? "D1" : null,
      };
    });
  }
}

class ThrowingVerifier implements GuardVerifier {
  calls = 0;
  async verify(): Promise<VerifierVerdict[]> {
    this.calls += 1;
    throw new Error("verifier exploded");
  }
}

// (a) all grounded → nothing redacted, verifier NOT called.
{
  const fake = new FakeVerifier({});
  const out = await guardOutput(
    [{ key: "nextStep", text: "Confirm the $5,000 Q3 repaint with Bob Stevens." }],
    SOURCES,
    { mode: "conservative", verifier: fake },
  );
  ok(out.manifest.referencesRedacted === 0, "all-grounded: nothing redacted");
  ok(out.manifest.referencesGrounded === out.manifest.referencesDetected, "all-grounded: every ref grounded");
  ok(fake.calls === 0, "all-grounded: verifier NOT called (no suspects → no Claude cost)");
  ok(out.fields["nextStep"].includes("Bob Stevens"), "all-grounded: text unchanged");
}

// (b) ungrounded + NO verifier → conservative redacts (fail-safe backbone).
{
  const out = await guardOutput(
    [{ key: "nextStep", text: "Call Dana Klein at 555-999-0000 about Q4." }],
    SOURCES,
    { mode: "conservative" },
  );
  ok(out.manifest.referencesRedacted >= 2, "no-verifier: ungrounded refs redacted");
  ok(!out.fields["nextStep"].includes("Dana Klein"), "no-verifier: ungrounded name removed");
  ok(!out.fields["nextStep"].includes("555-999-0000"), "no-verifier: ungrounded phone removed");
  ok(out.fields["nextStep"].includes("[unverified]"), "no-verifier: placeholder inserted");
}

// (c) ungrounded but verifier RESCUES (paraphrase support the string match missed).
{
  const fake = new FakeVerifier({ "Bobby Stevens": { supported: true, sourceId: "D1" } });
  const out = await guardOutput(
    [{ key: "summary", text: "Bobby Stevens is your champion." }],
    SOURCES,
    { mode: "conservative", verifier: fake },
  );
  ok(fake.calls === 1, "rescue: verifier called for the suspect");
  ok(out.manifest.referencesRedacted === 0, "rescue: verifier-supported ref kept");
  ok(
    out.manifest.findings.some((f) => f.basis === "verifier" && f.grounded),
    "rescue: finding basis is 'verifier'",
  );
  ok(out.fields["summary"].includes("Bobby Stevens"), "rescue: text preserved");
}

// (d) ungrounded + verifier CONFIRMS unsupported → redacted.
{
  const fake = new FakeVerifier({ "Dana Klein": { supported: false } });
  const out = await guardOutput(
    [{ key: "summary", text: "Loop in Dana Klein next." }],
    SOURCES,
    { mode: "conservative", verifier: fake },
  );
  ok(out.manifest.referencesRedacted === 1, "verifier-confirm: unsupported ref redacted");
  ok(!out.fields["summary"].includes("Dana Klein"), "verifier-confirm: name removed");
}

// (e) verifier THROWS → fail-safe: error recorded, conservative still redacts.
{
  const thrower = new ThrowingVerifier();
  const out = await guardOutput(
    [{ key: "summary", text: "Call Dana Klein." }],
    SOURCES,
    { mode: "conservative", verifier: thrower },
  );
  ok(thrower.calls === 1, "verifier-throw: verifier was invoked");
  ok(out.manifest.verifierError !== null, "verifier-throw: error recorded in manifest");
  ok(out.manifest.referencesRedacted === 1, "verifier-throw: conservative STILL redacts (paranoid)");
  ok(!out.fields["summary"].includes("Dana Klein"), "verifier-throw: ungrounded name removed");
}

// (f) off mode → nothing changes, but findings recorded (observe-only).
{
  const fake = new FakeVerifier({});
  const out = await guardOutput(
    [{ key: "summary", text: "Call Dana Klein." }],
    SOURCES,
    { mode: "off", verifier: fake },
  );
  ok(out.fields["summary"] === "Call Dana Klein.", "off: text unchanged");
  ok(out.manifest.referencesRedacted === 0, "off: nothing redacted");
  ok(fake.calls === 0, "off: verifier not called");
  ok(out.manifest.referencesDetected >= 1, "off: references still detected (observe-only)");
}

// (g) balanced mode → flagged, not redacted.
{
  const out = await guardOutput(
    [{ key: "summary", text: "Call Dana Klein." }],
    SOURCES,
    { mode: "balanced" },
  );
  ok(out.fields["summary"].includes("Dana Klein"), "balanced: text NOT redacted");
  ok(out.manifest.referencesFlagged >= 1, "balanced: ungrounded ref flagged");
  ok(out.manifest.referencesRedacted === 0, "balanced: nothing redacted");
}

// (h) verifier suspects are DEDUPED by span across fields.
{
  const fake = new FakeVerifier({});
  await guardOutput(
    [
      { key: "a", text: "Call Dana Klein." },
      { key: "b", text: "Dana Klein again." },
    ],
    SOURCES,
    { mode: "conservative", verifier: fake },
  );
  const suspectSpans = fake.lastRequest?.suspects.map((s) => s.span) ?? [];
  ok(
    suspectSpans.filter((s) => s === "Dana Klein").length === 1,
    "dedupe: a repeated suspect span is sent to the verifier once",
  );
}

// ---------------------------------------------------------------------------
console.log("\n## Verifier request + parse (pure)");
// ---------------------------------------------------------------------------
{
  const { body, labelToId } = buildVerifierRequest({
    sources: SOURCES,
    suspects: [
      { field: "summary", span: "Dana Klein", category: "person-name", context: "Loop in Dana Klein." },
    ],
  });
  ok(body.model === GUARD_VERIFIER_MODEL, "verifier request uses claude-sonnet-4-6");
  ok(
    body.system.length === 1 && body.system[0].cache_control?.type === "ephemeral",
    "verifier system is ONE cached layer (methodology-style forever cache)",
  );
  ok(labelToId.get("S1") === "D1", "source labels map back to real ids (S1 → D1)");
  ok(buildVerifierSystemPrompt().toLowerCase().includes("conservative"), "system prompt is conservative");
}
{
  const labelToId = new Map([["S1", "D1"]]);
  const v1 = parseVerifierVerdicts(
    { verdicts: [{ span: "Bob", supported: true, source: "S1" }] },
    labelToId,
  );
  ok(v1[0].supported && v1[0].sourceId === "D1", "parse: supported + known label → grounded with id");
  const v2 = parseVerifierVerdicts(
    { verdicts: [{ span: "X", supported: true, source: "S9" }] },
    labelToId,
  );
  ok(!v2[0].supported && v2[0].sourceId === null, "parse: supported but UNKNOWN label → unsupported (can't trust)");
  const v3 = parseVerifierVerdicts(
    { verdicts: [{ span: "Y", supported: false, source: null }] },
    labelToId,
  );
  ok(!v3[0].supported, "parse: explicit unsupported stays unsupported");
}
{
  let threw = false;
  try {
    extractVerdictsFromResponse({ stop_reason: "refusal" }, new Map());
  } catch {
    threw = true;
  }
  ok(threw, "extract: a refusal throws");
  const fenced = extractVerdictsFromResponse(
    {
      content: [
        { type: "text", text: '```json\n{"verdicts":[{"span":"Bob","supported":true,"source":"S1"}]}\n```' },
      ],
    },
    new Map([["S1", "D1"]]),
  );
  ok(fenced.length === 1 && fenced[0].sourceId === "D1", "extract: tolerates a ```json fence");
}

// ---------------------------------------------------------------------------
console.log("\n## Coaching adapter — drop ungrounded points, inline-redact free text");
// ---------------------------------------------------------------------------
{
  const result: CoachingResult = {
    priorities: [
      { focus: "Develop the implication", lens: "structure", action: "Quantify the cost of the leak before proposing." },
      { focus: "Confirm the decision maker", lens: "relationship", action: "Lock the next meeting with Dana Klein directly." },
    ],
    reinforce: [
      { focus: "Good pacing", lens: "communication", note: "You let the silence work after the price." },
    ],
    nextStep: "Email Dana Klein at dana@klein.com to confirm Q3.",
    summary: "Strong call with Bob Stevens; close the loop on the $5,000 repaint.",
  };
  const guarded = await guardCoachingResult(result, SOURCES, { mode: "conservative" });
  ok(
    guarded.result.priorities.length === 1 &&
      guarded.result.priorities[0].focus === "Develop the implication",
    "adapter: drops the priority that names ungrounded 'Dana Klein', keeps the grounded one",
  );
  ok(guarded.prioritiesDropped === 1, "adapter: prioritiesDropped counted");
  ok(guarded.result.reinforce.length === 1, "adapter: a fully-grounded reinforcement is kept");
  ok(
    !guarded.result.nextStep.includes("Dana Klein") &&
      !guarded.result.nextStep.includes("dana@klein.com"),
    "adapter: nextStep is inline-redacted (ungrounded name + email removed)",
  );
  ok(
    guarded.result.summary.includes("Bob Stevens") && guarded.result.summary.includes("$5,000"),
    "adapter: grounded summary details (Bob Stevens, $5,000) preserved",
  );
  ok(typeof formatGuardManifest(guarded.manifest) === "string", "manifest formats to a log line");
}

// ---------------------------------------------------------------------------
console.log(`\n${fails.length === 0 ? "ALL PASS" : `${fails.length} FAILED`}`);
fails.forEach((f) => console.log(`  ✗ ${f}`));
process.exit(fails.length === 0 ? 0 : 1);
}

main();
