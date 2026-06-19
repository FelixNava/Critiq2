/**
 * Coaching Output Layer prompt construction (Phase 21). Pure + exported so the exact
 * prompt and output contract are unit-tested without a network call.
 *
 * Layered for prompt caching (Phase 17's buildCachedSystem), most-stable-first — the
 * same two-layer cache the brief/script/debrief use:
 *   - SYSTEM layer 1: the LOCKED COACHING METHODOLOGY block (how Critiq turns a
 *     finished call into advice through the SPIN/Voss/Navarro lens). Identical on
 *     every call → cached forever.
 *   - SYSTEM layer 2: the REP PROFILE (from intake). Identical per rep → cached per
 *     rep.
 *   - USER message: the account + the debrief + the score (if any). Volatile → never
 *     cached.
 *
 * THE COACHING CONTRACT (the heart of this phase): unlike Reporter Mode (Phase 20,
 * which only organizes and must NOT advise), here Critiq IS a coach — it gives
 * direct, prioritized advice. But it earns the right to advise only by grounding
 * every point in what actually happened: the rep's report, the call's open
 * questions/commitments, and — when the call was recorded and scored — the objective
 * three-pillar score and the scorer's own findings. It never invents a quote, a
 * number, a name, or an outcome (the conservative honesty rule that sets up Phase
 * 26's hallucination guard). Fewer, sharper priorities beat a padded list.
 */

import { renderAccountKnowledge } from "@/lib/workingmemory/consumerPrompt";
import { COACHING_LENSES, type CoachingContext } from "./types";

/**
 * The locked coaching-methodology system block. Stable across all calls (no per-call
 * data) → cached forever. Frames the three pillars as the lens Critiq uses to find
 * the HIGHEST-LEVERAGE thing to work on, and sets the honesty + concision rules.
 */
export function buildSystemPrompt(): string {
  return [
    "You are Critiq, an expert sales coach. A field sales rep has just finished a call and reported what happened (and, when the call was recorded, it has already been scored). Your job NOW is to coach: give the rep a small number of sharp, specific, high-leverage things to work on, reinforce what worked, and recommend one concrete next step.",
    "This is different from the debrief, which only organized what happened. Here you ARE allowed — expected — to give advice and direction. Be the voice of a great sales manager who is on this rep's side: direct, specific, encouraging, never fluffy.",
    "",
    "You coach through three pillars (the same methodology the rep's calls are scored against):",
    "",
    "STRUCTURE (SPIN): how the conversation was shaped — surfacing the buyer's real problems, developing the implications/cost of those problems, and getting the BUYER to articulate the payoff. Implication is the highest-leverage, most-often-missed SPIN skill.",
    "",
    "COMMUNICATION (Voss): the mechanics — mirroring, labeling the other side's emotion, calibrated 'how'/'what' questions, tactical empathy, and using silence instead of filling it.",
    "",
    "RELATIONSHIP (Navarro): genuine curiosity about the buyer's world, a long-term orientation over a one-time close, and command of the territory (knowing the account, being proactive, setting a real next step).",
    "",
    "HOW TO PRIORITIZE:",
    "- If the call was SCORED, lead with the pillars/areas where the rep scored lowest and the scorer's own improvement notes — that's where the points (and the deals) are. Reinforce the pillars where they scored well.",
    "- If the call was NOT scored (no recording), coach from the rep's report and the open questions: what did the rep do that shaped the call, and what's the most useful adjustment for next time on THIS account?",
    "- Either way, pick the 1–3 changes that would most move this relationship forward. Do not list every possible improvement — a rep can only work on a couple of things at a time.",
    "",
    "WHAT YOU PRODUCE:",
    "- Priorities: 1–3 things to work on next. Each names a focus, the pillar lens it belongs to, and a CONCRETE action the rep can take on this account (not a generic tip). Tie it to what actually happened.",
    "- Reinforce: 0–3 things that worked, so the rep keeps doing them. Only call out things the rep actually did.",
    "- Next step: the single most important concrete next action with this account (a follow-up, a thing to send, a person to reach), grounded in the call's commitments and open questions.",
    "- A one-line summary the rep can skim.",
    "",
    "HONESTY RULES (critical — your credibility depends on this):",
    "- Ground every priority, reinforcement, and the next step in what the rep reported, the call's open questions/commitments, or the score's findings. NEVER invent a quote, a name, a number, an outcome, or a commitment that wasn't there.",
    "- Do not praise or criticize things that didn't happen. If the report is thin, give fewer, shorter points and focus the next step — do not pad the list to hit a count.",
    "- Be specific to THIS rep and THIS account. Avoid generic coaching that could apply to any call.",
    "",
    buildOutputFormatSpec(),
  ].join("\n");
}

/**
 * The exact JSON output contract. Specified in the prompt (not strict structured
 * outputs) and parsed defensively (anthropic.ts), matching the brief/score/debrief
 * approach.
 */
export function buildOutputFormatSpec(): string {
  const lenses = COACHING_LENSES.join(" | ");
  return [
    "OUTPUT FORMAT:",
    "Respond with ONLY a single JSON object — no markdown code fences, no commentary before or after it. The object must have exactly this shape:",
    "{",
    '  "priorities": [ { "focus": "<short label of what to improve>", "lens": "<' +
      lenses +
      '>", "action": "<the concrete, account-specific action to take>" } ],',
    '  "reinforce": [ { "focus": "<short label of what worked>", "lens": "<' +
      lenses +
      '>", "note": "<what it earned / why it worked, grounded in the call>" } ],',
    '  "nextStep": "<the single most important concrete next action with this account>",',
    '  "summary": "<one short plain-language line the rep can skim>"',
    "}",
    "Rules for the fields:",
    "- `priorities`: 1–3 items, ordered most-important first; each `lens` MUST be one of: " +
      lenses +
      ". Use `general` only when it isn't cleanly one pillar.",
    "- `reinforce`: 0–3 items. Return [] (not invented filler) when there's nothing genuine to reinforce.",
    "- `nextStep`: always present and concrete; if the call set no clear follow-up, recommend the most useful one based on the open questions.",
    "- Every field must be grounded in the rep's report, the call's open questions/commitments, or the score. Specific and actionable — no generic tips.",
  ].join("\n");
}

/** Render the structured debrief into the labeled block the coach reads. Pure. */
function renderDebrief(ctx: CoachingContext): string {
  const d = ctx.debrief;
  const lines: string[] = [];
  if (d.recap && d.recap.trim()) {
    lines.push("WHAT HAPPENED (the rep's account):", d.recap.trim(), "");
  }
  if (d.observations.length > 0) {
    lines.push("WHAT CRITIQ NOTICED (neutral observations, by pillar lens):");
    for (const o of d.observations) {
      lines.push(`- [${o.lens}] ${o.note}`);
    }
    lines.push("");
  }
  if (d.commitments.length > 0) {
    lines.push("COMMITMENTS / NEXT STEPS FROM THE CALL:");
    for (const c of d.commitments) lines.push(`- ${c}`);
    lines.push("");
  }
  if (d.openQuestions.length > 0) {
    lines.push("OPEN QUESTIONS / LOOSE ENDS:");
    for (const q of d.openQuestions) lines.push(`- ${q}`);
    lines.push("");
  }
  return lines.join("\n").trim() || "(the debrief was sparse)";
}

/** Render the objective score block, or the explicit no-score note. Pure. */
function renderScore(ctx: CoachingContext): string {
  if (!ctx.score) {
    return [
      "OBJECTIVE CALL SCORE:",
      "(this call was not recorded, so there is no three-pillar score — coach from the rep's report and the open questions; do NOT invent or imply a score)",
    ].join("\n");
  }
  const { snapshot, strengths, improvements } = ctx.score;
  const lines: string[] = [
    "OBJECTIVE CALL SCORE (from the recorded transcript — weight your priorities toward the weakest areas):",
    `- Overall: ${snapshot.overall} / 100`,
    `- Structure (SPIN): ${snapshot.spin} / 35`,
    `- Communication (Voss): ${snapshot.voss} / 35`,
    `- Relationship (Navarro): ${snapshot.navarro} / 30`,
  ];
  if (snapshot.partialJudgement) {
    lines.push(
      "- NOTE: this was a partial judgement (some of the call could not be evaluated) — treat the score as directional.",
    );
  }
  if (strengths.length > 0) {
    lines.push("", "THE SCORER ALSO NOTED THESE STRENGTHS:");
    for (const s of strengths) lines.push(`- ${s}`);
  }
  if (improvements.length > 0) {
    lines.push("", "THE SCORER ALSO NOTED THESE IMPROVEMENT AREAS:");
    for (const i of improvements) lines.push(`- ${i}`);
  }
  return lines.join("\n");
}

/**
 * The per-call user message: the account context + the debrief + the score (if any).
 * Volatile → never cached.
 */
export function buildUserPrompt(ctx: CoachingContext): string {
  return [
    "Coach the rep on the call below. Return only the structured JSON result.",
    "",
    "ACCOUNT: " + ctx.accountName,
    "PIPELINE STAGE: " + ctx.accountStage,
    "",
    "WHAT CRITIQ ALREADY KNOWS ABOUT THIS ACCOUNT (shared running summary):",
    renderAccountKnowledge(ctx.memoryContext, ctx.accountSummary),
    "",
    "THE DEBRIEF OF THE CALL THE REP JUST FINISHED:",
    renderDebrief(ctx),
    "",
    renderScore(ctx),
  ].join("\n");
}
