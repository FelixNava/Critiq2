/**
 * Pre-call brief types (Phase 18). The brief is the prep step's AI output: a
 * diagnostic read of the account + a strategic approach + anticipated objections,
 * and (interaction 3+) a recommended call objective. Phase 19 turns the objective
 * + approach into the actual delivery-cued script — kept OUT of this phase.
 */

import type { ObjectiveMode } from "./objective";

/** One strategic prep point: what to focus on and why it fits this account. */
export interface ApproachPoint {
  focus: string;
  why: string;
}

/** An objection the rep may hear, with a methodology-grounded way to handle it. */
export interface AnticipatedObjection {
  objection: string;
  response: string;
}

/** The structured brief the model returns (already parsed + normalized). */
export interface BriefResult {
  /** Where the account stands + what's likely to move it (plain language). */
  diagnosis: string;
  /**
   * Critiq's recommended call objective. Non-null ONLY when Critiq leads
   * objective-setting (interaction 3+); null on interactions 1–2, where the rep
   * sets it.
   */
  recommendedObjective: string | null;
  /** 2–4 strategic focus points for the call. */
  approach: ApproachPoint[];
  /** 0–3 anticipated objections + how to handle them. */
  objections: AnticipatedObjection[];
  /** One short paragraph a busy rep can read in seconds. */
  summary: string;
}

/** The context assembled for a single brief generation. */
export interface BriefContext {
  accountName: string;
  accountStage: string;
  /** Shared running account intelligence; null/empty at cold start. */
  accountSummary: string | null;
  /** The rep's narration of context + call goal. */
  narration: string;
  /** 1-based interaction number with this account (drives the objective rule). */
  interactionNumber: number;
  /** Derived from interactionNumber: 'rep' (1–2) or 'signal' (3+). */
  objectiveMode: ObjectiveMode;
  /**
   * The rep's stated objective, when they set it (interactions 1–2). Critiq
   * builds the brief AROUND this rather than recommending one.
   */
  repObjective: string | null;
  /** A stable, formatted rep-profile block (from intake), or null if none. */
  repProfile: string | null;
}

/** A generator that turns a BriefContext into a BriefResult (DI seam for tests). */
export interface BriefGenerator {
  generate(context: BriefContext): Promise<BriefResult>;
}
