/**
 * Post-call debrief types (Phase 20 — Reporter Mode, Signal PRD Step 05). The rep
 * REPORTS what happened on a call through guided observational prompts, and Critiq
 * STRUCTURES that account into an organized recap + neutral observations + the
 * commitments/next steps + open follow-ups.
 *
 * Reporter Mode is deliberately OBSERVATIONAL, not evaluative: it organizes the
 * rep's account, it does not grade or advise. Numeric scoring lives in the
 * recorded-transcript path (call_scores, Phase 16); coaching ADVICE is Phase 21.
 * Keeping the debrief neutral is what lets Phase 21 layer coaching on top and
 * Phase 23 consolidate it into account memory without double-counting judgment.
 */

/** The lens an observation is viewed through — the three pillars as neutral themes. */
export const OBSERVATION_LENSES = [
  "structure", // SPIN — how the conversation was shaped (questions, need development)
  "communication", // Voss — mechanics (listening, labeling, calibrated questions, silence)
  "relationship", // Navarro — curiosity, long-term orientation, trust/territory
  "general", // not cleanly one pillar
] as const;

export type ObservationLens = (typeof OBSERVATION_LENSES)[number];

/** One neutral observation about what happened, tagged by lens. NOT advice. */
export interface DebriefObservation {
  note: string;
  lens: ObservationLens;
}

/** The structured debrief the model returns (already parsed + normalized). */
export interface DebriefResult {
  /** An organized 2–4 sentence narrative of what happened on the call. */
  recap: string;
  /** 2–5 neutral observations through the pillar lenses (what happened, not a grade). */
  observations: DebriefObservation[];
  /** Concrete commitments / next steps that came out of the call. */
  commitments: string[];
  /** Unresolved items worth following up on (feeds the next prep + account memory). */
  openQuestions: string[];
  /** One short plain-language takeaway the rep can read in seconds. */
  summary: string;
}

/**
 * The rep's raw guided answers — the episodic source of truth, stored verbatim.
 * Only `happened` is required; the rest sharpen the structuring when present.
 */
export interface DebriefReport {
  /** What the rep set out to do (objective recall). */
  objective?: string;
  /** What actually happened — the core narrative. REQUIRED. */
  happened: string;
  /** How the other side reacted (mood, energy, pushback). */
  reaction?: string;
  /** What was decided / committed to / the next step. */
  commitments?: string;
  /** Anything that surprised the rep or that they're unsure about. */
  surprises?: string;
}

/** The context assembled for a single debrief generation. */
export interface DebriefContext {
  accountName: string;
  accountStage: string;
  /** Shared running account intelligence; null/empty at cold start. */
  accountSummary: string | null;
  /** The rep's guided report of the call. */
  report: DebriefReport;
  /** A stable, formatted rep-profile block (from intake), or null if none. */
  repProfile: string | null;
}

/** A generator that turns a DebriefContext into a DebriefResult (DI seam for tests). */
export interface DebriefGenerator {
  generate(context: DebriefContext): Promise<DebriefResult>;
}
