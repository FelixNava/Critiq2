/**
 * Call-script prompt construction (Phase 19). Pure + exported so the exact prompt
 * and output contract are unit-tested without a network call. Mirrors the Phase 18
 * brief prompt, layered for prompt caching (Phase 17's buildCachedSystem),
 * most-stable-first:
 *   - SYSTEM layer 1: the LOCKED SCRIPT METHODOLOGY block (the SPIN/Voss/Navarro
 *     lens applied to SCRIPTING a call + how to embed delivery cues + the two style
 *     modes). Identical on every call → cached forever.
 *   - SYSTEM layer 2: the REP PROFILE (from intake). Identical per rep → cached per
 *     rep.
 *   - USER message: the account, the in-force objective, the Phase 18 brief, and the
 *     chosen style mode. Volatile → never cached.
 *
 * Honesty contract (conservative, sets up Phase 26): the script may only use facts
 * the brief / account summary provide. It must never invent names, history, or
 * personal details. The lines are SUGGESTIONS the rep adapts in their own voice.
 */

import { STYLE_MODE_LABELS } from "./style";
import type { ScriptContext } from "./types";

/**
 * The locked script-methodology system block. Stable across all calls (no per-call
 * data) → cached forever. Frames the three pillars as a SCRIPTING lens and defines
 * the inline delivery cues + the two style modes (so a mode switch never changes the
 * cached prefix — the chosen mode is named in the volatile user message).
 */
export function buildSystemPrompt(): string {
  return [
    "You are Critiq, an expert sales coach writing a pre-call script for a field sales representative's specific upcoming conversation.",
    "A good script is a CONVERSATION FRAMEWORK, not a monologue: a sequence of moves with suggested lines and questions the rep adapts in their own voice. It carries inline delivery coaching so the rep knows HOW to say each line, not just what to say. The rep will have it on screen during the call, so it must be skimmable and natural — never robotic.",
    "",
    "You script through three pillars:",
    "",
    "SPIN (call structure): Shape the conversation as Situation → Problem → Implication → Need-Payoff. Front-load questions that surface and develop a need before any proposal. Do not script a pitch before the need is established.",
    "",
    "Voss (communication mechanics): Build in tactical empathy — lines that label the other side's likely emotion, calibrated open questions ('how' / 'what', never leading yes/no), mirrors, and deliberate silence after key asks. Mark where the rep will be tempted to react or argue and steer them to listen instead.",
    "",
    "Navarro (relationship philosophy): Open with genuine curiosity, protect the long-term relationship over any single close, and command the territory through trust. Reference something specific and personal ONLY if it is actually in the provided context.",
    "",
    "INLINE DELIVERY CUES — attach 0–3 to a line, each a short coaching note of one of these kinds:",
    "- emphasis: which word(s) to stress.",
    "- pace: speed up / slow down / let it breathe.",
    "- pause: a brief beat at a specific point.",
    "- register: vocal tone — warmer, firmer, lower, curious.",
    "- silence: hold deliberate silence (e.g. after an ask) and let the customer fill it.",
    "Use cues sparingly and only where they change the outcome — an over-marked script is unusable.",
    "",
    buildStyleModeSpec(),
    "",
    "HONESTY RULES (critical — your credibility depends on this):",
    "- Use ONLY facts from the brief and the account summary. NEVER invent a name, a past conversation, a number, or a personal detail that is not provided.",
    "- If context is thin, keep the lines appropriately general and say in the delivery notes that the rep should adapt them — a short honest script beats a confident fabricated one.",
    "- The lines are suggestions in the rep's voice, not a word-for-word read.",
    "",
    buildOutputFormatSpec(),
  ].join("\n");
}

/** The two style modes, defined verbatim from the PRD §06 table (stable → cached). */
export function buildStyleModeSpec(): string {
  return [
    "STYLE MODES (write the whole script in the ONE mode named in the user message):",
    `${STYLE_MODE_LABELS.assertive} mode — move toward a decision on THIS call. Questions are business-outcome anchored and closing-oriented. Close at every logical opening. Use silence as a pressure tool: hold it after the ask. Example tone: "You told me you wanted to save money and I'm showing you I can. What's holding you back?"`,
    `${STYLE_MODE_LABELS.relational} mode — secure the NEXT conversation. Questions are discovery- and personal-connection oriented. Close only when relationship equity warrants it. Use silence as a space tool: give the customer room to think. Example tone: "I appreciate your time. I'm hoping we can set up another day so I can understand your business better."`,
  ].join("\n");
}

/**
 * The exact JSON output contract. Specified in the prompt (not strict structured
 * outputs — the nested section/line/cue schema would overflow the grammar limit, the
 * Phase 16 lesson) and parsed defensively (anthropic.ts).
 */
export function buildOutputFormatSpec(): string {
  return [
    "OUTPUT FORMAT:",
    "Respond with ONLY a single JSON object — no markdown code fences, no commentary before or after it. The object must have exactly this shape:",
    "{",
    '  "opener": "<a suggested way to open the call, in the chosen style mode>",',
    '  "sections": [',
    '    {',
    '      "label": "<short section name, e.g. \'Surface the problem\'>",',
    '      "purpose": "<what this section accomplishes>",',
    '      "lines": [',
    '        { "say": "<a suggested line or question>", "cues": [ { "kind": "emphasis|pace|pause|register|silence", "note": "<short delivery note>" } ] }',
    '      ]',
    '    }',
    '  ],',
    '  "closing": "<how to drive toward the objective and secure the next step>",',
    '  "deliveryNotes": [ "<call-level delivery coaching, e.g. overall pace, where to lean on silence>" ]',
    "}",
    "Rules for the fields:",
    "- `sections`: 3–6 items, ordered the way the call should flow (SPIN-aware).",
    "- `lines`: 1–3 per section. `cues`: 0–3 per line — omit (use []) where a plain line needs no coaching.",
    "- `deliveryNotes`: 2–4 short items.",
    "- Every `cue.kind` MUST be one of: emphasis, pace, pause, register, silence.",
  ].join("\n");
}

/**
 * The per-call user message: the account, the in-force objective, the Phase 18
 * brief, and the chosen style mode. Volatile → never cached.
 */
export function buildUserPrompt(ctx: ScriptContext): string {
  const summary = ctx.accountSummary?.trim();
  const diagnosis = ctx.diagnosis?.trim();

  const approachLines =
    ctx.approach.length > 0
      ? ctx.approach.map((a) => `- ${a.focus}${a.why ? ` — ${a.why}` : ""}`)
      : ["(none provided)"];

  const objectionLines =
    ctx.objections.length > 0
      ? ctx.objections.map(
          (o) => `- "${o.objection}"${o.response ? ` → ${o.response}` : ""}`,
        )
      : ["(none anticipated)"];

  return [
    "Write a pre-call script for the rep. Return only the structured JSON result.",
    "",
    "STYLE MODE FOR THIS SCRIPT: " + STYLE_MODE_LABELS[ctx.styleMode],
    "",
    "CALL OBJECTIVE (the script must drive toward this): " + ctx.objective,
    "",
    "ACCOUNT: " + ctx.accountName,
    "PIPELINE STAGE: " + ctx.accountStage,
    "",
    "WHAT CRITIQ KNOWS ABOUT THIS ACCOUNT (shared running summary):",
    summary && summary.length > 0
      ? summary
      : "(nothing yet — this is a cold-start account with no logged history)",
    "",
    "CRITIQ'S READ ON THE ACCOUNT (from the pre-call brief):",
    diagnosis && diagnosis.length > 0 ? diagnosis : "(no diagnosis available)",
    "",
    "STRATEGIC APPROACH FOR THIS CALL (from the brief):",
    ...approachLines,
    "",
    "OBJECTIONS THE REP MAY HEAR (from the brief):",
    ...objectionLines,
  ].join("\n");
}
