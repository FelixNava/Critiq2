/**
 * Post-call debrief prompt construction (Phase 20 — Reporter Mode). Pure + exported
 * so the exact prompt and output contract are unit-tested without a network call.
 *
 * Layered for prompt caching (Phase 17's buildCachedSystem), most-stable-first —
 * the same two-layer cache the brief uses:
 *   - SYSTEM layer 1: the LOCKED REPORTER METHODOLOGY block (the SPIN/Voss/Navarro
 *     lens applied to ORGANIZING a finished call). Identical on every call → cached
 *     forever.
 *   - SYSTEM layer 2: the REP PROFILE (from intake). Identical per rep → cached per
 *     rep.
 *   - USER message: the account + the rep's guided report. Volatile → never cached.
 *
 * THE REPORTER CONTRACT (the heart of this phase): Critiq is a REPORTER here, not a
 * judge. It organizes what the rep said happened — it does NOT score, grade, praise,
 * or advise. (Numeric scoring is the recorded-transcript path; coaching advice is a
 * later phase.) Observations are neutral statements of what occurred, viewed through
 * the three pillars, never a verdict on quality.
 *
 * Honesty contract (conservative, sets up Phase 26's hallucination guard): the
 * debrief may use ONLY what the rep reported and what is in the shared account
 * summary. It must never invent quotes, names, numbers, outcomes, or commitments
 * the rep did not state. A thin report yields a short honest debrief, not a padded one.
 */

import { renderAccountKnowledge } from "@/lib/workingmemory/consumerPrompt";
import { OBSERVATION_LENSES, type DebriefContext } from "./types";
import { assembleReportNarration } from "./reporter";

/**
 * The locked reporter-methodology system block. Stable across all calls (no per-call
 * data) → cached forever. Frames the three pillars as an OBSERVATIONAL lens for
 * organizing a finished call, explicitly NOT the scoring rubric.
 */
export function buildSystemPrompt(): string {
  return [
    "You are Critiq, an expert sales coach helping a field sales representative debrief a call they just finished.",
    "Right now your ONLY job is to be a clear, faithful REPORTER. The rep will tell you what happened; you organize it into a clean, structured record they (and Critiq's memory of the account) can rely on later. You are NOT grading the call, NOT assigning a score, and NOT giving advice or next-call coaching. Just organize what happened, accurately and neutrally.",
    "",
    "You organize the call through three pillars — the same lens the rep's calls are later scored against, but here used only to NOTICE and CATEGORIZE what happened, never to judge it:",
    "",
    "STRUCTURE (SPIN): how the conversation was shaped — what was surfaced, which problems and implications came up, whether a need got developed.",
    "",
    "COMMUNICATION (Voss): the mechanics that showed up — listening, labeling the other side's emotion, calibrated 'how'/'what' questions, mirroring, silence, or the lack of them.",
    "",
    "RELATIONSHIP (Navarro): the relationship signals — curiosity, long-term orientation, trust, and command of the territory.",
    "",
    "WHAT YOU PRODUCE:",
    "- A recap: a tight, organized narrative of what happened, in plain language, drawn strictly from the rep's report.",
    "- Observations: neutral notes about what occurred, each tagged with the lens it belongs to. An observation states a FACT about the call ('the rep asked how the budget was set, which opened up the real constraint'), never a grade ('good job asking…') and never advice ('next time ask…').",
    "- Commitments: the concrete things that were decided or that either side agreed to, including the next step — only ones the rep actually reported.",
    "- Open questions: genuine loose ends and uncertainties worth resolving before the next call. These can include things the rep flagged as unsure.",
    "- A one-line summary the rep can skim.",
    "",
    "HONESTY RULES (critical — your credibility depends on this):",
    "- Use ONLY what the rep reported and what is in the account summary. NEVER invent a quote, a name, a number, an outcome, or a commitment that was not stated.",
    "- Do not infer that something good or bad happened that the rep didn't describe. If the report is thin, keep the debrief short and say what's missing rather than padding it.",
    "- Stay neutral. No praise, no criticism, no coaching. If you catch yourself writing 'should', 'try', 'good', or 'great', rewrite it as a plain observation of what happened.",
    "",
    buildOutputFormatSpec(),
  ].join("\n");
}

/**
 * The exact JSON output contract. Specified in the prompt (not strict structured
 * outputs) and parsed defensively (anthropic.ts), matching the brief/score approach.
 */
export function buildOutputFormatSpec(): string {
  const lenses = OBSERVATION_LENSES.join(" | ");
  return [
    "OUTPUT FORMAT:",
    "Respond with ONLY a single JSON object — no markdown code fences, no commentary before or after it. The object must have exactly this shape:",
    "{",
    '  "recap": "<2–4 sentences: an organized, neutral narrative of what happened, drawn only from the report>",',
    '  "observations": [ { "note": "<a neutral statement of something that happened>", "lens": "<' +
      lenses +
      '>" } ],',
    '  "commitments": [ "<a concrete thing decided or agreed, including the next step>" ],',
    '  "openQuestions": [ "<a genuine loose end worth resolving before next time>" ],',
    '  "summary": "<one short plain-language line the rep can skim>"',
    "}",
    "Rules for the fields:",
    "- `observations`: 2–5 items when the report supports them; each `lens` MUST be one of: " +
      lenses +
      ". Use `general` when it isn't cleanly one pillar.",
    "- `commitments` and `openQuestions`: 0–5 items each. Return [] (not invented filler) when the report doesn't contain them.",
    "- Every field must be grounded in the rep's report. Neutral and factual — no scores, no praise, no advice.",
  ].join("\n");
}

/**
 * The per-call user message: the account context + the rep's assembled guided
 * report. Volatile → never cached.
 */
export function buildUserPrompt(ctx: DebriefContext): string {
  const narration =
    assembleReportNarration(ctx.report) || "(the rep did not add details)";

  return [
    "Organize this debrief for the rep. Return only the structured JSON result.",
    "",
    "ACCOUNT: " + ctx.accountName,
    "PIPELINE STAGE: " + ctx.accountStage,
    "",
    "WHAT CRITIQ ALREADY KNOWS ABOUT THIS ACCOUNT (shared running summary):",
    renderAccountKnowledge(ctx.memoryContext, ctx.accountSummary),
    "",
    "THE REP'S REPORT OF THE CALL THEY JUST FINISHED:",
    narration,
  ].join("\n");
}
