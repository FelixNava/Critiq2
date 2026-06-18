/**
 * Account consolidation prompt construction (Phase 23). Pure + exported so the exact
 * prompt and output contract are unit-tested without a network call.
 *
 * Layered for prompt caching (Phase 17's buildCachedSystem):
 *   - SYSTEM layer 1: the LOCKED CONSOLIDATION METHODOLOGY block (how Critiq turns a
 *     pile of debriefs into one running account summary, and the hard attribution +
 *     honesty rules). Identical on every call → cached forever.
 *   - USER message: the account + its debrief history. Volatile → never cached.
 *
 * There is NO rep-profile layer here (unlike the brief/coaching): the account summary
 * is SHARED and rep-agnostic, so it must not be tailored to — or leak — any one rep.
 *
 * THE CONSOLIDATION CONTRACT (the heart of this phase):
 *   - Produce ONE running summary of the ACCOUNT (not a per-call recap): where the
 *     relationship stands now, what's known about how they buy, and the open threads.
 *   - SOURCE-ATTRIBUTE every fact. Each fact names the debrief id it came from. A claim
 *     Critiq can't ground in a specific debrief does not belong in the summary. This is
 *     the contract Phase 26's hallucination guard depends on.
 *   - Be conservative and current: prefer recent debriefs when the account has changed;
 *     don't invent continuity, sentiment, names, numbers, or commitments that aren't in
 *     the debriefs. Fewer, well-grounded facts beat a padded list.
 */

import { ACCOUNT_FACT_LENSES, type ConsolidationContext } from "./types";

/**
 * The locked consolidation-methodology system block. Stable across all calls (no
 * per-call data) → cached forever.
 */
export function buildSystemPrompt(): string {
  return [
    "You are Critiq's account memory. You maintain a single running summary of a sales ACCOUNT by consolidating the rep's post-call debriefs into durable account knowledge. This summary is shared by every rep who works the account and is what Critiq loads before the next call, so it must be accurate, current, and grounded.",
    "",
    "WHAT YOU PRODUCE — a summary of the ACCOUNT, not a recap of the last call:",
    "- A headline: one line on where this account/relationship stands right now.",
    "- A narrative: a short running summary (a few sentences) — the state of the relationship, what's known about how they buy and what they care about, and the live threads / next steps. Write about the account and the buyer(s); do NOT write about the rep or name the rep.",
    "- Facts: the durable, specific things worth remembering about this account, each ATTRIBUTED to the debrief it came from.",
    "",
    "SOURCE ATTRIBUTION (the hard rule — your credibility and Critiq's depend on it):",
    "- Every fact MUST cite the id of the debrief it is grounded in (the `sourceDebriefId`). Use only the debrief ids given to you below.",
    "- State a fact only if a specific debrief supports it. If you cannot point to the debrief, do NOT include it. Never invent a name, a number, a budget, a commitment, a date, or a sentiment that isn't in the debriefs.",
    "- When a later debrief supersedes an earlier one (plans change, a deal advances), prefer the NEWER debrief and attribute the current fact to it. Don't carry forward stale facts as if still true.",
    "",
    "HOW TO CONSOLIDATE:",
    "- Read the debriefs newest-first; the most recent ones describe where things stand now.",
    "- Merge repetition: if several debriefs say the same thing, keep one fact (attributed to the clearest/most recent source). Keep distinct facts distinct.",
    "- Tag each fact with the pillar lens it most relates to (structure = how the deal/conversation is being shaped; communication = how they talk / what lands; relationship = trust, who the players are, long-term posture; general = anything else, e.g. logistics or commercial terms).",
    "- Be concise. A handful of sharp, sourced facts is far more useful than an exhaustive list.",
    "",
    buildOutputFormatSpec(),
  ].join("\n");
}

/**
 * The exact JSON output contract. Specified in the prompt (not strict structured
 * outputs — the nested attributed-fact array, like the score/script schemas, is
 * parsed defensively) and validated in anthropic.ts.
 */
export function buildOutputFormatSpec(): string {
  const lenses = ACCOUNT_FACT_LENSES.join(" | ");
  return [
    "OUTPUT FORMAT:",
    "Respond with ONLY a single JSON object — no markdown code fences, no commentary before or after it. The object must have exactly this shape:",
    "{",
    '  "headline": "<one line: where this account stands right now>",',
    '  "narrative": "<a few sentences of running summary about the account and the buyer(s)>",',
    '  "facts": [ { "text": "<one durable, specific fact about the account>", "lens": "<' +
      lenses +
      '>", "sourceDebriefId": "<the id of the debrief this fact comes from>" } ]',
    "}",
    "Rules for the fields:",
    "- `facts`: each `sourceDebriefId` MUST be one of the debrief ids listed below. A fact without a valid source id will be discarded, so attribute carefully.",
    "- `lens` MUST be one of: " + lenses + ". Use `general` when it isn't cleanly one pillar.",
    "- `headline` and `narrative` must be supported by the debriefs — do not assert anything you can't trace to one.",
    "- Return `facts: []` (not invented filler) if the debriefs genuinely contain nothing durable yet.",
  ].join("\n");
}

/** Render one debrief into the labeled block the consolidator reads. Pure. */
function renderDebrief(d: ConsolidationContext["debriefs"][number]): string {
  const lines: string[] = [`DEBRIEF id=${d.label}:`];
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
 * The per-call user message: the account context + its debrief history (newest first).
 * Volatile → never cached.
 */
export function buildUserPrompt(ctx: ConsolidationContext): string {
  const parts: string[] = [
    "Consolidate the debrief history below into the running account summary. Return only the structured JSON result.",
    "",
    "ACCOUNT: " + ctx.accountName,
    "PIPELINE STAGE: " + ctx.accountStage,
    "",
    `DEBRIEF HISTORY (${ctx.debriefs.length} debrief(s), newest first). Attribute every fact to one of these ids:`,
    "",
  ];
  parts.push(ctx.debriefs.map(renderDebrief).join("\n\n"));
  if (ctx.truncatedOlderCount > 0) {
    parts.push(
      "",
      `(${ctx.truncatedOlderCount} older debrief(s) are not shown here. Summarize from the most recent debriefs above; do not invent what the older calls contained.)`,
    );
  }
  return parts.join("\n");
}
