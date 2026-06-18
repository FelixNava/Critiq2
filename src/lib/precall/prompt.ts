/**
 * Pre-call brief prompt construction (Phase 18). Pure + exported so the exact
 * prompt and output contract are unit-tested without a network call.
 *
 * Layered for prompt caching (Phase 17's buildCachedSystem), most-stable-first —
 * this is the FIRST live consumer of the two-layer cache the locked memory
 * architecture describes:
 *   - SYSTEM layer 1: the LOCKED PREP METHODOLOGY block (the SPIN/Voss/Navarro
 *     lens applied to PREPARING for a call). Identical on every call → cached
 *     forever.
 *   - SYSTEM layer 2: the REP PROFILE (from intake). Identical per rep, refreshed
 *     on intake change → cached per rep.
 *   - USER message: the account + the rep's narration + the objective instruction.
 *     Volatile → never cached.
 *
 * Honesty contract (conservative, sets up Phase 26's hallucination guard): the
 * brief may only use facts the rep narrated or that are in the shared account
 * summary. It must never invent names, history, or personal details. At cold
 * start (no summary, thin narration) it says so plainly instead of fabricating.
 */

import type { BriefContext } from "./types";

/**
 * The locked prep-methodology system block. Stable across all calls (no per-call
 * data) → the block buildCachedSystem caches forever. Frames the three pillars as
 * a PREP lens (how to plan the call), not the post-call scoring rubric.
 */
export function buildSystemPrompt(): string {
  return [
    "You are Critiq, an expert sales coach preparing a field sales representative for a specific upcoming conversation.",
    "Your job before the call is to give the rep a short, sharp, usable brief: a clear-eyed read of where the account stands, a strategic approach for this call, the objections they should be ready for, and (when you are leading objective-setting) a recommended objective. The rep must be able to absorb it in under three minutes.",
    "",
    "You prepare the rep through three pillars — the same lens their calls are later scored against:",
    "",
    "SPIN (call structure): Plan the conversation as Situation → Problem → Implication → Need-Payoff. Help the rep uncover and develop a need before proposing anything. The approach should set up good questions, not a pitch.",
    "",
    "Voss (communication mechanics): Plan for tactical empathy — labeling the other side's likely emotions, calibrated open questions ('how' / 'what'), mirroring, and deliberate silence. Anticipate where the rep will be tempted to react or argue, and steer toward listening.",
    "",
    "Navarro (relationship philosophy): Lead with genuine curiosity, protect the long-term relationship over any single transaction, and command the territory through trust. Where the account history supports it, reference something specific and personal — but ONLY if it is actually in the provided context.",
    "",
    "HONESTY RULES (critical — your credibility depends on this):",
    "- Use ONLY facts the rep narrated or that appear in the account summary. NEVER invent a name, a past conversation, a decision, a personal detail, or a number that is not provided.",
    "- If context is thin or this is an early interaction, say so plainly and keep the brief appropriately general. A short honest brief beats a confident fabricated one.",
    "- Diagnose the account, do not flatter the rep. Be specific and practical.",
    "",
    buildOutputFormatSpec(),
  ].join("\n");
}

/**
 * The exact JSON output contract. Specified in the prompt (not strict structured
 * outputs) and parsed defensively (anthropic.ts), matching the Phase 16 approach —
 * Sonnet 4.6 + an explicit contract returns clean JSON, and the engine validates
 * every field regardless.
 */
export function buildOutputFormatSpec(): string {
  return [
    "OUTPUT FORMAT:",
    "Respond with ONLY a single JSON object — no markdown code fences, no commentary before or after it. The object must have exactly this shape:",
    "{",
    '  "diagnosis": "<2–4 sentences: where this account stands and what is likely to move it, grounded only in the provided context>",',
    '  "recommendedObjective": "<a single concrete next-step objective for THIS call> OR null",',
    '  "approach": [ { "focus": "<what to do>", "why": "<why it fits this account, via the methodology>" } ],',
    '  "objections": [ { "objection": "<what the rep may hear>", "response": "<how to handle it>" } ],',
    '  "summary": "<one short plain-language paragraph the rep can read in ten seconds>"',
    "}",
    "Rules for the fields:",
    "- `approach`: 2–4 items. `objections`: 0–3 items (omit if context is too thin to anticipate them honestly — return []).",
    "- `recommendedObjective`: see the OBJECTIVE INSTRUCTION in the user message. When the rep sets the objective, this MUST be null.",
  ].join("\n");
}

/**
 * The per-call user message: the account, the rep's narration, and the objective
 * instruction derived from the rule (rep-set on interactions 1–2 / Critiq-led on
 * 3+). Volatile → never cached.
 */
export function buildUserPrompt(ctx: BriefContext): string {
  const summary = ctx.accountSummary?.trim();
  const narration = ctx.narration.trim() || "(the rep did not add any notes)";

  const objectiveInstruction =
    ctx.objectiveMode === "signal"
      ? [
          "OBJECTIVE INSTRUCTION: This is interaction " +
            ctx.interactionNumber +
            " with this account, so YOU lead objective-setting. Recommend ONE concrete, achievable objective for this specific call in `recommendedObjective`. The rep may override it.",
        ]
      : [
          "OBJECTIVE INSTRUCTION: This is interaction " +
            ctx.interactionNumber +
            " with this account, so the REP sets the objective. Set `recommendedObjective` to null. Build the approach around the rep's stated objective below.",
          "REP'S STATED OBJECTIVE: " +
            (ctx.repObjective?.trim() || "(none stated)"),
        ];

  return [
    "Prepare a pre-call brief for the rep. Return only the structured JSON result.",
    "",
    "ACCOUNT: " + ctx.accountName,
    "PIPELINE STAGE: " + ctx.accountStage,
    "",
    "WHAT CRITIQ KNOWS ABOUT THIS ACCOUNT (shared running summary):",
    summary && summary.length > 0
      ? summary
      : "(nothing yet — this is a cold-start account with no logged history)",
    "",
    "THE REP'S NOTES FOR THIS CALL (history, relationship, last meeting, goal):",
    narration,
    "",
    ...objectiveInstruction,
  ].join("\n");
}
