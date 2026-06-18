/**
 * Phase 18 unit verification — pre-call brief flow, pure logic only (no network,
 * no DB). Imports the REAL app modules (no re-implementation, per the standing
 * rule). The real Claude round-trip + the brief QUALITY are the runtime gate
 * Felix + the expert coach validate; the real-Postgres store/generate path is a
 * throwaway probe. This proves deterministically: the objective HARD RULE, the
 * prompt + output contract, request construction (incl. the two cache layers),
 * response parsing/normalization, and the rep-profile formatter.
 *
 * Run: pnpm tsx scripts/verify-phase18.ts
 */
import {
  MAX_NARRATION,
  MAX_OBJECTIVE,
  OBJECTIVE_HANDOFF_THRESHOLD,
  nextInteractionNumber,
  resolveObjectiveMode,
  signalLeadsObjective,
} from "../src/lib/precall/objective";
import {
  buildOutputFormatSpec,
  buildSystemPrompt,
  buildUserPrompt,
} from "../src/lib/precall/prompt";
import {
  BRIEF_MODEL,
  buildBriefRequest,
  extractBriefFromResponse,
  extractJsonObject,
  parseBriefJson,
} from "../src/lib/precall/anthropic";
import { formatRepProfile } from "../src/lib/precall/repProfile";
import type { BriefContext } from "../src/lib/precall/types";

const fails: string[] = [];
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) fails.push(msg);
};

function ctx(over: Partial<BriefContext> = {}): BriefContext {
  return {
    accountName: "Riverside Contractors",
    accountStage: "active",
    accountSummary: "Repeat buyer; price-sensitive; values durability.",
    narration: "Last call stalled on price. Want a walkthrough date.",
    interactionNumber: 1,
    objectiveMode: "rep",
    repObjective: "Lock in a walkthrough date",
    repProfile: null,
    ...over,
  };
}

// ---------- The objective HARD RULE ----------
{
  ok(OBJECTIVE_HANDOFF_THRESHOLD === 3, "handoff threshold is interaction 3");
  ok(resolveObjectiveMode(1) === "rep", "interaction 1 → rep sets objective");
  ok(resolveObjectiveMode(2) === "rep", "interaction 2 → rep sets objective");
  ok(resolveObjectiveMode(3) === "signal", "interaction 3 → Critiq recommends");
  ok(resolveObjectiveMode(7) === "signal", "interaction 7 → Critiq recommends");
  ok(resolveObjectiveMode(0) === "rep", "interaction 0 fails safe to rep");
  ok(resolveObjectiveMode(NaN) === "rep", "NaN interaction fails safe to rep");
  ok(!signalLeadsObjective(2), "signalLeadsObjective false on interaction 2");
  ok(signalLeadsObjective(3), "signalLeadsObjective true on interaction 3");
  ok(nextInteractionNumber(0) === 1, "0 prior interactions → next is 1");
  ok(nextInteractionNumber(2) === 3, "2 prior interactions → next is 3 (Critiq leads)");
  ok(nextInteractionNumber(-5) === 1, "negative prior count fails safe to next 1");
  ok(MAX_NARRATION > 0 && MAX_OBJECTIVE > 0, "input guards are positive");
}

// ---------- System prompt (locked methodology) ----------
{
  const sys = buildSystemPrompt();
  ok(/SPIN/.test(sys) && /Voss/.test(sys) && /Navarro/.test(sys), "system names all three pillars");
  ok(/HONESTY RULES/.test(sys), "system carries the honesty/anti-hallucination rules");
  ok(/NEVER invent/i.test(sys), "system forbids inventing details");
  ok(/three minutes/i.test(sys), "system reflects the <3-minute usability constraint");
  ok(sys.includes(buildOutputFormatSpec()), "system embeds the output contract");
  const spec = buildOutputFormatSpec();
  ok(/"diagnosis"/.test(spec) && /"recommendedObjective"/.test(spec), "contract names diagnosis + recommendedObjective");
  ok(/"approach"/.test(spec) && /"objections"/.test(spec) && /"summary"/.test(spec), "contract names approach + objections + summary");
}

// ---------- User prompt (rep mode vs signal mode) ----------
{
  const rep = buildUserPrompt(ctx({ objectiveMode: "rep", interactionNumber: 2, repObjective: "Book the walkthrough" }));
  ok(/REP sets the objective/i.test(rep), "rep-mode prompt instructs the rep sets the objective");
  ok(/recommendedObjective` to null/i.test(rep) || /null/.test(rep), "rep-mode prompt forces null recommendation");
  ok(/Book the walkthrough/.test(rep), "rep-mode prompt carries the rep's stated objective");
  ok(/Riverside Contractors/.test(rep), "prompt includes the account name");

  const sig = buildUserPrompt(ctx({ objectiveMode: "signal", interactionNumber: 4, repObjective: null }));
  ok(/YOU lead objective-setting/i.test(sig), "signal-mode prompt instructs Critiq to lead");
  ok(/interaction 4/i.test(sig), "signal-mode prompt states the interaction number");

  const cold = buildUserPrompt(ctx({ accountSummary: null }));
  ok(/cold-start account/i.test(cold), "cold-start summary placeholder is honest about no history");
}

// ---------- Request construction (model, thinking, two cache layers) ----------
{
  const noProfile = buildBriefRequest(ctx({ repProfile: null }));
  ok(noProfile.model === BRIEF_MODEL && noProfile.model === "claude-sonnet-4-6", "request uses the locked model");
  ok(noProfile.thinking.type === "adaptive", "request uses adaptive thinking");
  ok(noProfile.system.length === 1, "no rep profile → single system layer (methodology)");
  ok(noProfile.system[0].cache_control?.type === "ephemeral", "methodology layer carries a cache breakpoint");
  ok(noProfile.messages[0].role === "user", "request has a single user message");

  const withProfile = buildBriefRequest(ctx({ repProfile: "THE REP: closes hard, money-motivated." }));
  ok(withProfile.system.length === 2, "rep profile present → two system layers");
  ok(withProfile.system[1].cache_control?.type === "ephemeral", "rep-profile layer carries its own cache breakpoint");
  ok(/closes hard/.test(withProfile.system[1].text), "rep-profile layer carries the profile text");
}

// ---------- JSON extraction (fence/prose tolerant) ----------
{
  ok((extractJsonObject('{"a":1}') as { a?: number })?.a === 1, "extractJsonObject parses bare JSON");
  ok((extractJsonObject('```json\n{"a":2}\n```') as { a?: number })?.a === 2, "extractJsonObject strips a code fence");
  ok((extractJsonObject('Here:\n{"a":3}\nThanks') as { a?: number })?.a === 3, "extractJsonObject recovers JSON in prose");
  ok(extractJsonObject("not json") === null, "extractJsonObject returns null on garbage");
}

// ---------- Brief normalization ----------
{
  const full = parseBriefJson({
    diagnosis: "  Stalled on price.  ",
    recommendedObjective: "Book a walkthrough",
    approach: [
      { focus: "Lead with durability", why: "They reward long-term value" },
      { focus: "", why: "dropped — no focus" },
    ],
    objections: [
      { objection: "Too expensive", response: "Reframe on cost-of-failure" },
      { objection: "", response: "dropped" },
    ],
    summary: "Short read.",
  });
  ok(full.diagnosis === "Stalled on price.", "diagnosis is trimmed");
  ok(full.recommendedObjective === "Book a walkthrough", "recommendedObjective kept when present");
  ok(full.approach.length === 1, "approach drops items with no focus");
  ok(full.objections.length === 1, "objections drop items with no objection text");

  const nullRec = parseBriefJson({ diagnosis: "d", recommendedObjective: "null", summary: "s" });
  ok(nullRec.recommendedObjective === null, "string 'null' recommendation normalizes to null");
  const emptyRec = parseBriefJson({ diagnosis: "d", recommendedObjective: "   " });
  ok(emptyRec.recommendedObjective === null, "blank recommendation normalizes to null");

  const garbage = parseBriefJson({ approach: "nope", objections: 5 });
  ok(Array.isArray(garbage.approach) && garbage.approach.length === 0, "non-array approach coerces to []");
  ok(Array.isArray(garbage.objections) && garbage.objections.length === 0, "non-array objections coerces to []");
  ok(garbage.diagnosis === "" && garbage.summary === "", "missing diagnosis/summary coerce to empty strings");
}

// ---------- Response parsing (refusal/empty/garbage/valid) ----------
{
  let refused = false;
  try { extractBriefFromResponse({ stop_reason: "refusal", content: [] }); } catch { refused = true; }
  ok(refused, "a refusal stop_reason throws");

  let truncated = false;
  try { extractBriefFromResponse({ stop_reason: "max_tokens", content: [{ type: "text", text: "{}" }] }); } catch { truncated = true; }
  ok(truncated, "a max_tokens truncation throws");

  let empty = false;
  try { extractBriefFromResponse({ stop_reason: "end_turn", content: [] }); } catch { empty = true; }
  ok(empty, "empty content throws");

  let bad = false;
  try { extractBriefFromResponse({ content: [{ type: "text", text: "not json" }] }); } catch { bad = true; }
  ok(bad, "non-JSON text throws");

  const valid = extractBriefFromResponse({
    stop_reason: "end_turn",
    content: [
      { type: "thinking", text: "...reasoning..." },
      { type: "text", text: JSON.stringify({ diagnosis: "Stalled.", recommendedObjective: null, approach: [{ focus: "ask why", why: "diagnose" }], objections: [], summary: "Go diagnose." }) },
    ],
  });
  ok(valid.diagnosis === "Stalled.", "extracts the JSON past the thinking block");
  ok(valid.recommendedObjective === null, "carries a null recommendation through");
  ok(valid.approach[0].focus === "ask why", "carries the approach through");
}

// ---------- Rep-profile formatter (stable, drops empties) ----------
{
  ok(formatRepProfile([]) === null, "no intake rows → null profile (layer dropped)");
  ok(
    formatRepProfile([{ dimension: "identity", questionKey: "legacy", answer: "   " }]) === null,
    "only-empty answers → null profile",
  );
  const block = formatRepProfile([
    { dimension: "relationships", questionKey: "lead_or_listen", answer: "listen" },
    { dimension: "identity", questionKey: "motivator", answer: ["winning", "money"] },
    { dimension: "identity", questionKey: "legacy", answer: { text: "be the go-to rep" } },
    { dimension: "unknown_dim", questionKey: "x", answer: "ignored-but-rendered" },
  ]);
  ok(block != null, "produces a profile block from usable answers");
  if (block) {
    ok(block.indexOf("Identity & motivation") < block.indexOf("Relationship style"), "dimensions render in INTAKE order (identity before relationships)");
    ok(/winning, money/.test(block), "array answer rendered as a joined list");
    ok(/be the go-to rep/.test(block), "object answer rendered from its scalar values");
    ok(/THE REP YOU ARE COACHING/.test(block), "profile block carries its coaching header");
  }
}

console.log(
  fails.length === 0
    ? `\n✅ Phase 18 verification PASSED — all checks green.`
    : `\n❌ Phase 18 verification FAILED — ${fails.length} check(s):\n  - ${fails.join("\n  - ")}`,
);
process.exit(fails.length === 0 ? 0 : 1);
