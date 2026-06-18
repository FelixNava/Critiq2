/**
 * Coaching Output Layer types (Phase 21). This is the interaction loop's payoff
 * step: a COMPLETED Phase 20 debrief (the rep's neutral Reporter-Mode account) and —
 * when the call was recorded and scored — the Phase 16 call_score (the objective
 * three-pillar evaluation) become ADVICE.
 *
 * Reporter Mode (Phase 20) deliberately withholds advice; scoring (Phase 16) is a
 * number with evidence. Coaching is the first place the two are combined and the
 * first place Critiq is allowed to say "do this next." The contract that keeps it
 * honest (and sets up Phase 26's hallucination guard): every priority must be
 * grounded in something the rep actually reported or in the score's own findings —
 * never invented. A thin debrief yields fewer, shorter coaching points, not padding.
 *
 * The lens vocabulary is shared with the debrief (Structure / Communication /
 * Relationship / general) so a rep sees one consistent taxonomy across the surface
 * they just read and the coaching layered on top of it.
 */

import {
  OBSERVATION_LENSES,
  type ObservationLens,
} from "@/lib/debrief/types";

/** Coaching uses the same pillar-themed lenses the debrief observations use. */
export type CoachingLens = ObservationLens;
export const COACHING_LENSES = OBSERVATION_LENSES;

/** One thing to work on next — grounded advice, tagged by pillar lens. */
export interface CoachingPriority {
  /** The short label of what to improve (e.g. "Develop the implication"). */
  focus: string;
  lens: CoachingLens;
  /** The concrete, specific-to-this-call action the rep should take. */
  action: string;
}

/** Something that worked — reinforce it so the rep keeps doing it. */
export interface CoachingReinforcement {
  focus: string;
  lens: CoachingLens;
  /** Why it worked / what it earned — grounded in the call. */
  note: string;
}

/** The structured coaching the model returns (already parsed + normalized). */
export interface CoachingResult {
  /** 1–3 highest-leverage things to work on next. */
  priorities: CoachingPriority[];
  /** 0–3 things that worked, worth reinforcing. */
  reinforce: CoachingReinforcement[];
  /** The single concrete recommended next action for this account. */
  nextStep: string;
  /** One short plain-language takeaway the rep can skim. */
  summary: string;
}

/**
 * The objective three-pillar score, snapshotted at coaching-generation time. Present
 * ONLY when the debrief was linked to a recorded call that has a completed Phase 16
 * score; null otherwise (most beta debriefs are of un-recorded calls). Mirrors the
 * call_scores aggregate columns. The pillar ceilings (35/35/30) live in the rubric.
 */
export interface ScoreSnapshot {
  overall: number;
  spin: number;
  voss: number;
  navarro: number;
  /** True when the score was a partial judgement (a rubric dimension was omitted). */
  partialJudgement: boolean;
}

/**
 * The debrief slice coaching reads — the Phase 20 structured output. Coaching never
 * re-derives the recap/observations; it advises ON them.
 */
export interface CoachingDebriefInput {
  recap: string | null;
  observations: { note: string; lens: CoachingLens }[];
  commitments: string[];
  openQuestions: string[];
  summary: string | null;
}

/** The objective half, when a recorded call was scored. */
export interface CoachingScoreInput {
  snapshot: ScoreSnapshot;
  /** The scorer's own coaching seeds (call_scores.strengths/improvements). */
  strengths: string[];
  improvements: string[];
}

/** The context assembled for a single coaching generation. */
export interface CoachingContext {
  accountName: string;
  accountStage: string;
  /** Shared running account intelligence; null/empty at cold start. */
  accountSummary: string | null;
  /** The completed debrief being coached. */
  debrief: CoachingDebriefInput;
  /** The objective score, or null when the call wasn't recorded/scored. */
  score: CoachingScoreInput | null;
  /** A stable, formatted rep-profile block (from intake), or null if none. */
  repProfile: string | null;
}

/** A generator that turns a CoachingContext into a CoachingResult (DI seam). */
export interface CoachingGenerator {
  generate(context: CoachingContext): Promise<CoachingResult>;
}
