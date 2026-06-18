/**
 * The locked three-pillar scoring rubric (Phase 16) — Critiq's core methodology.
 *
 * Every sales call is scored out of 100 across three pillars (the locked weights
 * from /critiq-context "What Critiq Is"):
 *   - SPIN Selling      35 pts — call STRUCTURE (Situation/Problem/Implication/Need-Payoff)
 *   - Voss (Tactical    35 pts — communication MECHANICS (mirroring, labeling,
 *     Empathy)                   calibrated questions, tactical empathy, silence)
 *   - Navarro           30 pts — relationship PHILOSOPHY (Alex's own IP: curiosity,
 *                                long-term orientation, territory command)
 *
 * This module is the SINGLE SOURCE OF TRUTH for the rubric: the scoring prompt
 * (prompt.ts), the structured-output JSON schema (anthropic.ts), the aggregate
 * math (score.ts), and the DB column mapping (store.ts) are all derived from it.
 * Change a weight or a sub-dimension here and everything downstream follows.
 *
 * The definitions are deliberately concrete + behavioral so the model scores
 * against observable rep behavior, not vibes — and so Phase 26's hallucination
 * guard can require transcript evidence per sub-dimension. The rubric itself is
 * FLAGGED for Felix + the expert sales coach to validate (the relaxed aggressive
 * gate does not block on scoring quality).
 */

/** The three pillars, with their locked point ceilings. */
export type PillarKey = "spin" | "voss" | "navarro";

export interface Pillar {
  key: PillarKey;
  /** Display label. */
  name: string;
  /** What this pillar measures (one line — feeds the prompt header). */
  focus: string;
  /** Locked point ceiling for the pillar (sub-dimension maxes sum to this). */
  maxPoints: number;
}

export interface Dimension {
  /** Stable key (used in the JSON schema, the model's output, and the store). */
  key: string;
  pillar: PillarKey;
  /** Display label. */
  name: string;
  /** Point ceiling for this sub-dimension. */
  maxPoints: number;
  /** What earns points here — behavioral, so the model scores what it can cite. */
  criteria: string;
}

export const PILLARS: Record<PillarKey, Pillar> = {
  spin: {
    key: "spin",
    name: "SPIN Selling",
    focus: "Call structure — does the rep move Situation → Problem → Implication → Need-Payoff?",
    maxPoints: 35,
  },
  voss: {
    key: "voss",
    name: "Voss Tactical Empathy",
    focus: "Communication mechanics — mirroring, labeling, calibrated questions, empathy, silence.",
    maxPoints: 35,
  },
  navarro: {
    key: "navarro",
    name: "Navarro Methodology",
    focus: "Relationship philosophy — genuine curiosity, long-term orientation, territory command.",
    maxPoints: 30,
  },
};

/**
 * The locked sub-dimensions. Order is stable (it drives the prompt + schema).
 * The per-dimension maxPoints sum to each pillar's ceiling and to 100 overall —
 * asserted at import time by `assertRubricIntegrity()` below.
 */
export const DIMENSIONS: Dimension[] = [
  // ---- SPIN (35) ----
  {
    key: "situation",
    pillar: "spin",
    name: "Situation",
    maxPoints: 5,
    criteria:
      "Asked efficient situation questions to establish context (current products, volume, decision process) WITHOUT over-asking facts already known or easily researched. Penalize a long string of basic fact-finding that bores the buyer.",
  },
  {
    key: "problem",
    pillar: "spin",
    name: "Problem",
    maxPoints: 10,
    criteria:
      "Surfaced the buyer's real problems, dissatisfactions, and pain points (e.g. coating failures, delivery delays, margin pressure) rather than pitching features before any problem was established.",
  },
  {
    key: "implication",
    pillar: "spin",
    name: "Implication",
    maxPoints: 10,
    criteria:
      "Developed the consequences and cost of those problems (rework, lost jobs, downtime, reputation) so the buyer feels the problem is worth solving. This is the hardest, highest-leverage SPIN skill.",
  },
  {
    key: "needPayoff",
    pillar: "spin",
    name: "Need-Payoff",
    maxPoints: 10,
    criteria:
      "Got the BUYER to articulate the value of a solution ('so if this held up, you'd stop losing those repaint jobs?') rather than the rep stating the benefit themselves.",
  },
  // ---- Voss (35) ----
  {
    key: "mirroring",
    pillar: "voss",
    name: "Mirroring",
    maxPoints: 7,
    criteria:
      "Repeated the last 1-3 words of the buyer's statement to draw out more, keeping the buyer talking and revealing more than they planned.",
  },
  {
    key: "labeling",
    pillar: "voss",
    name: "Labeling",
    maxPoints: 7,
    criteria:
      "Named the buyer's emotion or position ('it sounds like…', 'it seems like reliability matters most to you') to defuse negatives and reinforce positives.",
  },
  {
    key: "calibratedQuestions",
    pillar: "voss",
    name: "Calibrated Questions",
    maxPoints: 8,
    criteria:
      "Asked open 'how' / 'what' questions that give the buyer the illusion of control and make them solve the rep's problem ('how am I supposed to do that?', 'what would need to be true?'). Penalize closed/leading questions and 'why' accusations.",
  },
  {
    key: "tacticalEmpathy",
    pillar: "voss",
    name: "Tactical Empathy",
    maxPoints: 7,
    criteria:
      "Demonstrated understanding of the buyer's perspective before persuading, including an accusation audit that pre-empts objections ('you probably think another rep is going to overpromise…').",
  },
  {
    key: "dynamicSilence",
    pillar: "voss",
    name: "Silence & Pacing",
    maxPoints: 6,
    criteria:
      "Used effective silence — let the buyer fill space after a label or question, did not talk over or rush to fill pauses, and kept a calm late-night-DJ pace. Penalize the rep dominating the airtime.",
  },
  // ---- Navarro (30) ----
  {
    key: "curiosity",
    pillar: "navarro",
    name: "Genuine Curiosity",
    maxPoints: 10,
    criteria:
      "Showed authentic curiosity about the buyer's business, crew, and world — asked about their jobs, challenges, and goals beyond the immediate transaction, learning the account rather than reciting a pitch.",
  },
  {
    key: "longTermRelationship",
    pillar: "navarro",
    name: "Long-Term Orientation",
    maxPoints: 10,
    criteria:
      "Oriented toward a durable relationship over a one-time close — offered help with no immediate payback, respected the buyer's timeline, and framed the rep as a long-term partner, not a transaction.",
  },
  {
    key: "territoryCommand",
    pillar: "navarro",
    name: "Territory Command",
    maxPoints: 10,
    criteria:
      "Showed ownership and command of the territory/account — knew the buyer's context, competitors, and recent history, was proactive with relevant intel, and set a concrete, valuable next step.",
  },
];

/** Dimensions belonging to one pillar, in rubric order. */
export function dimensionsForPillar(pillar: PillarKey): Dimension[] {
  return DIMENSIONS.filter((d) => d.pillar === pillar);
}

/** Stable list of all sub-dimension keys, in rubric order. */
export const DIMENSION_KEYS: string[] = DIMENSIONS.map((d) => d.key);

/** Lookup a dimension's max by key (0 for an unknown key). */
export function maxForDimension(key: string): number {
  return DIMENSIONS.find((d) => d.key === key)?.maxPoints ?? 0;
}

export const OVERALL_MAX = 100;

/**
 * Fail fast at import if the locked weights ever drift: each pillar's
 * sub-dimensions must sum to its ceiling, and the three ceilings must sum to 100.
 * This makes a bad edit a build/test failure rather than silently skewed scores.
 */
export function assertRubricIntegrity(): void {
  let overall = 0;
  for (const pillar of Object.values(PILLARS)) {
    const sum = dimensionsForPillar(pillar.key).reduce(
      (n, d) => n + d.maxPoints,
      0,
    );
    if (sum !== pillar.maxPoints) {
      throw new Error(
        `Rubric integrity: ${pillar.key} sub-dimensions sum to ${sum}, expected ${pillar.maxPoints}.`,
      );
    }
    overall += pillar.maxPoints;
  }
  if (overall !== OVERALL_MAX) {
    throw new Error(
      `Rubric integrity: pillars sum to ${overall}, expected ${OVERALL_MAX}.`,
    );
  }
}

// Enforce at module load — any downstream importer gets the guarantee for free.
assertRubricIntegrity();
