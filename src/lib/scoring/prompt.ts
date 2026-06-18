/**
 * Scoring prompt construction (Phase 16). Pure + exported so the exact prompt
 * and output schema are unit-tested without a network call.
 *
 * Two halves, deliberately split for prompt caching (Phase 17 wires the actual
 * cache_control breakpoint; this lays the structure):
 *   - SYSTEM (the LOCKED methodology block) — the role + the full SPIN/Voss/
 *     Navarro rubric + the rules. Identical on every call → cacheable forever.
 *   - USER (the per-call transcript) — the only volatile part → never cached.
 *
 * The output is constrained by a JSON schema (Anthropic structured outputs), so
 * the response is always parseable; the engine still validates ranges in code.
 */

import {
  DIMENSIONS,
  PILLARS,
  dimensionsForPillar,
  type PillarKey,
} from "./rubric";
import type { ScorableTranscript } from "./types";

/**
 * The locked methodology system prompt. Built from the rubric so it can never
 * drift from the schema/scoring math. Stable across all calls (no per-call data)
 * → this is the block Phase 17 caches.
 */
export function buildSystemPrompt(): string {
  const pillarBlocks = (Object.keys(PILLARS) as PillarKey[])
    .map((pk) => {
      const p = PILLARS[pk];
      const dims = dimensionsForPillar(pk)
        .map(
          (d) =>
            `  - ${d.name} (key: "${d.key}", 0–${d.maxPoints} pts): ${d.criteria}`,
        )
        .join("\n");
      return `${p.name} — ${p.maxPoints} points total. ${p.focus}\n${dims}`;
    })
    .join("\n\n");

  return [
    "You are Critiq, an expert sales-call evaluator for field sales representatives.",
    "You score a single recorded sales conversation against a fixed three-pillar rubric that totals 100 points. You are rigorous, specific, and fair — you reward observable skill and penalize its absence, and you never invent details that are not in the transcript.",
    "",
    "THE RUBRIC (100 points across three pillars):",
    "",
    pillarBlocks,
    "",
    "SCORING RULES:",
    "- Score ONLY the sales representative's behavior, not the buyer's.",
    "- Award each sub-dimension a whole number from 0 to its maximum. Use the full range: a skill that is absent scores 0; textbook execution scores the maximum; partial/clumsy attempts score in between.",
    "- For EVERY sub-dimension, the `evidence` array must contain short, VERBATIM quotes from the transcript that justify the score. If the skill never appears, score 0, give a one-line rationale explaining the absence, and return an EMPTY evidence array — never fabricate a quote.",
    "- Identify the speakers from context (diarization may label them Speaker 0/1). If you cannot reliably tell who the rep is, score conservatively and say so in the rationale.",
    "- `overallStrengths` and `overallImprovements` are concise, actionable coaching points (2–4 each). `summary` is one short plain-language paragraph a busy rep can read in ten seconds.",
    "- Do not award points for intent you infer but cannot quote. Evidence-free credit is the cardinal sin here.",
    "",
    buildOutputFormatSpec(),
  ].join("\n");
}

/**
 * The exact JSON output contract, derived from the rubric (single source of
 * truth). Critiq's scoring schema is too large for the API's strict
 * structured-output grammar, so the shape is specified in the prompt and parsed
 * defensively (anthropic.ts) instead. Sonnet 4.6 + this explicit contract returns
 * clean JSON reliably; the engine still validates every field.
 */
export function buildOutputFormatSpec(): string {
  const keyLines = DIMENSIONS.map(
    (d) => `  - "${d.key}" (integer 0–${d.maxPoints})`,
  ).join("\n");
  return [
    "OUTPUT FORMAT:",
    "Respond with ONLY a single JSON object — no markdown code fences, no commentary before or after it. The object must have exactly this shape:",
    "{",
    '  "dimensions": {',
    '    "<dimensionKey>": { "score": <integer>, "rationale": "<one sentence>", "evidence": ["<verbatim transcript quote>", ...] },',
    "    ... one entry for EVERY dimension key listed below ...",
    "  },",
    '  "overallStrengths": ["<coaching point>", ...],',
    '  "overallImprovements": ["<coaching point>", ...],',
    '  "summary": "<one short paragraph>"',
    "}",
    "Include an entry for every one of these dimension keys (and no others):",
    keyLines,
  ].join("\n");
}

/**
 * The per-call user message: the transcript to score, plus a short framing.
 * Partial transcripts are explicitly disclosed so the model scores what it has
 * without penalizing the rep for capture gaps it cannot see.
 */
export function buildUserPrompt(transcript: ScorableTranscript): string {
  const partialNote =
    transcript.status === "partial"
      ? "\n\nNOTE: This transcript is PARTIAL — some segments failed to transcribe, so the conversation may be incomplete. Score what is present; do not penalize the rep for missing audio."
      : "";
  const body = transcript.text.trim() || "(empty transcript)";
  return [
    "Score the following sales-call transcript against the rubric. Return only the structured result.",
    partialNote,
    "",
    "----- TRANSCRIPT START -----",
    body,
    "----- TRANSCRIPT END -----",
  ].join("\n");
}

/**
 * The JSON schema constraining the model's response (Anthropic structured
 * outputs). Derived from the rubric so the dimension set always matches. Note:
 * structured outputs do not support numeric min/max — the engine clamps ranges
 * in code (score.ts). `additionalProperties: false` is required on every object.
 */
export function buildOutputSchema(): Record<string, unknown> {
  const dimensionProps: Record<string, unknown> = {};
  for (const d of DIMENSIONS) {
    dimensionProps[d.key] = {
      type: "object",
      properties: {
        score: { type: "integer", description: `0–${d.maxPoints}` },
        rationale: { type: "string" },
        evidence: {
          type: "array",
          items: { type: "string" },
          description: "Verbatim transcript quotes (empty if the skill is absent).",
        },
      },
      required: ["score", "rationale", "evidence"],
      additionalProperties: false,
    };
  }
  return {
    type: "object",
    properties: {
      dimensions: {
        type: "object",
        properties: dimensionProps,
        required: DIMENSIONS.map((d) => d.key),
        additionalProperties: false,
      },
      overallStrengths: { type: "array", items: { type: "string" } },
      overallImprovements: { type: "array", items: { type: "string" } },
      summary: { type: "string" },
    },
    required: [
      "dimensions",
      "overallStrengths",
      "overallImprovements",
      "summary",
    ],
    additionalProperties: false,
  };
}
