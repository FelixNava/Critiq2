/**
 * Rep consolidation prompt construction (Phase 24). Pure + exported so the exact prompt
 * and output contract are unit-tested without a network call.
 *
 * Layered for prompt caching (Phase 17's buildCachedSystem):
 *   - SYSTEM layer 1: the LOCKED REP-CONSOLIDATION METHODOLOGY block (how Critiq turns a
 *     pile of one rep's debriefs into a running profile of how they sell, and the hard
 *     attribution + honesty rules). Identical on every call → cached forever.
 *   - USER message: this rep's debrief history. Volatile → never cached.
 *
 * There is NO rep-profile layer here (unlike the brief/coaching): this phase BUILDS the
 * learned rep profile, so feeding the static intake in would risk the model asserting
 * intake claims as debrief-grounded traits that then fail attribution. The methodology
 * is rep-agnostic (the same coaching lens for every rep); the rep's data lives in the
 * user message.
 *
 * THE REP-CONSOLIDATION CONTRACT (the heart of this phase):
 *   - Produce a DESCRIPTIVE profile of how the REP sells across their accounts — their
 *     strengths, recurring habits, and growth areas. Observational, not prescriptive:
 *     describe what the rep does, don't tell them what to do (coaching ADVICE is Phase
 *     21; this is memory). The profile is PRIVATE to the rep and is about the rep.
 *   - SOURCE-ATTRIBUTE every trait. Each trait names the debrief id it was observed in. A
 *     pattern Critiq can't ground in a specific debrief does not belong in the profile.
 *     This is the contract Phase 26's hallucination guard depends on.
 *   - Be conservative and current: prefer patterns seen across MULTIPLE debriefs over a
 *     one-off; prefer recent behavior when the rep is changing; don't invent tendencies,
 *     numbers, or outcomes that aren't in the debriefs. Fewer, well-grounded traits beat
 *     a padded list.
 */

import { REP_TRAIT_LENSES, type RepConsolidationContext } from "./types";

/**
 * The locked rep-consolidation-methodology system block. Stable across all calls (no
 * per-call data) → cached forever.
 */
export function buildSystemPrompt(): string {
  return [
    "You are Critiq's rep memory. You maintain a single PRIVATE running profile of one sales REP by consolidating their own post-call debriefs into a durable picture of how they sell. This profile is private to the rep, is about the rep, and is what Critiq loads to coach them more specifically over time — so it must be accurate, current, and grounded.",
    "",
    "WHAT YOU PRODUCE — a profile of the REP, not a recap of any one call or account:",
    "- A headline: one line on how this rep is selling right now / where their attention should go.",
    "- A narrative: a short running profile (a few sentences) — the rep's selling style, their consistent strengths, the habits and growth areas that recur across calls and accounts. Write about the rep (you may refer to them as 'the rep' or 'you'); describe what they do, do not prescribe what they should do.",
    "- Traits: the durable, specific patterns worth remembering about how this rep sells, each ATTRIBUTED to a debrief it was observed in.",
    "",
    "OBSERVATIONAL, NOT PRESCRIPTIVE (the boundary with coaching):",
    "- State what the rep does and how it tends to land — e.g. 'consistently builds rapport before pitching', 'often advances to next steps before surfacing the cost of the problem'. Do NOT write advice ('should', 'try', 'make sure to'); turning a pattern into a recommendation is Critiq's coaching step, not this memory.",
    "",
    "SOURCE ATTRIBUTION (the hard rule — your credibility and Critiq's depend on it):",
    "- Every trait MUST cite the id of a debrief it is grounded in (the `sourceDebriefId`). Use only the debrief ids given to you below.",
    "- State a pattern only if a specific debrief supports it. If you cannot point to the debrief, do NOT include it. Never invent a tendency, a number, an outcome, or an account detail that isn't in the debriefs.",
    "- Prefer patterns visible across SEVERAL debriefs; attribute the trait to the clearest or most recent one. A single call is a data point, not a pattern — say so or leave it out.",
    "",
    "HOW TO CONSOLIDATE:",
    "- Read the debriefs newest-first; the most recent ones describe how the rep is selling now.",
    "- Look ACROSS accounts: the value is the pattern that recurs regardless of which account the call was with.",
    "- Merge repetition: if several debriefs show the same tendency, keep one trait (attributed to the clearest/most recent source). Keep distinct patterns distinct.",
    "- Tag each trait with the pillar lens it most relates to (structure = SPIN, how they run discovery and shape the deal; communication = Voss, how they talk — mirroring, labeling, calibrated questions, silence; relationship = Navarro, curiosity, trust, long-term posture, territory; general = anything else, e.g. follow-through or process habits).",
    "- Be concise. A handful of sharp, sourced traits is far more useful than an exhaustive list.",
    "",
    buildOutputFormatSpec(),
  ].join("\n");
}

/**
 * The exact JSON output contract. Specified in the prompt (not strict structured outputs
 * — the nested attributed-trait array, like the score/script schemas, is parsed
 * defensively) and validated in anthropic.ts.
 */
export function buildOutputFormatSpec(): string {
  const lenses = REP_TRAIT_LENSES.join(" | ");
  return [
    "OUTPUT FORMAT:",
    "Respond with ONLY a single JSON object — no markdown code fences, no commentary before or after it. The object must have exactly this shape:",
    "{",
    '  "headline": "<one line: how this rep is selling right now>",',
    '  "narrative": "<a few sentences profiling how the rep sells — strengths, recurring habits, growth areas>",',
    '  "traits": [ { "text": "<one durable, specific pattern in how the rep sells>", "lens": "<' +
      lenses +
      '>", "sourceDebriefId": "<the id of a debrief this pattern was observed in>" } ]',
    "}",
    "Rules for the fields:",
    "- `traits`: each `sourceDebriefId` MUST be one of the debrief ids listed below. A trait without a valid source id will be discarded, so attribute carefully.",
    "- `lens` MUST be one of: " + lenses + ". Use `general` when it isn't cleanly one pillar.",
    "- `headline` and `narrative` must be supported by the debriefs — do not assert anything you can't trace to one.",
    "- Return `traits: []` (not invented filler) if the debriefs genuinely show no durable pattern yet.",
  ].join("\n");
}

/** Render one debrief into the labeled block the consolidator reads. Pure. */
function renderDebrief(d: RepConsolidationContext["debriefs"][number]): string {
  const lines: string[] = [`DEBRIEF id=${d.label} (account: ${d.accountName}):`];
  if (d.summary && d.summary.trim()) {
    lines.push(`  Takeaway: ${d.summary.trim()}`);
  }
  if (d.recap && d.recap.trim()) {
    lines.push(`  What happened: ${d.recap.trim()}`);
  }
  if (d.observations.length > 0) {
    lines.push("  Observations:");
    for (const o of d.observations) lines.push(`    - [${o.lens}] ${o.note}`);
  }
  if (d.commitments.length > 0) {
    lines.push("  Commitments / next steps:");
    for (const c of d.commitments) lines.push(`    - ${c}`);
  }
  if (d.openQuestions.length > 0) {
    lines.push("  Open questions:");
    for (const q of d.openQuestions) lines.push(`    - ${q}`);
  }
  return lines.join("\n");
}

/**
 * The per-call user message: the rep's debrief history (newest first, across accounts).
 * Volatile → never cached.
 */
export function buildUserPrompt(ctx: RepConsolidationContext): string {
  const parts: string[] = [
    "Consolidate this rep's debrief history below into their running selling profile. Return only the structured JSON result.",
    "",
    `REP DEBRIEF HISTORY (${ctx.debriefs.length} debrief(s) across the rep's accounts, newest first). Attribute every trait to one of these ids:`,
    "",
  ];
  parts.push(ctx.debriefs.map(renderDebrief).join("\n\n"));
  if (ctx.truncatedOlderCount > 0) {
    parts.push(
      "",
      `(${ctx.truncatedOlderCount} older debrief(s) are not shown here. Profile from the most recent debriefs above; do not invent what the older calls contained.)`,
    );
  }
  return parts.join("\n");
}
