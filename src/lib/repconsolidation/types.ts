/**
 * Rep consolidation types (Phase 24 — the SEMANTIC memory tier for REPS).
 *
 * The locked memory architecture has three tiers: Episodic (raw interactions, stored
 * forever) → Semantic (running summaries, regenerated event-based) → Working (loaded
 * into the prompt for the next call). Phase 23 built the ACCOUNT side of the semantic
 * tier (a SHARED, rep-agnostic summary regenerated after every debrief). Phase 24 builds
 * the REP side: a PRIVATE running profile of how a rep sells, regenerated every
 * REP_CONSOLIDATION_INTERVAL debriefs (the locked "rep-profile consolidation every 10
 * debriefs" policy).
 *
 * Two things make this the mirror-image of Phase 23, not a copy:
 *   1. It is REP-SCOPED + REP-PRIVATE. It reads ALL of one rep's completed debriefs
 *      across every account they work, and the result is read only by that rep (and
 *      admin). Rep-side data stays isolated (the privacy model). Account intelligence is
 *      shared; rep intelligence is not.
 *   2. Rep IDENTITY IS ALLOWED here (the account summary forbids it). The profile is
 *      explicitly about the rep — their strengths, recurring habits, and growth areas.
 *
 * Like the account summary, it source-attributes every trait to the debrief it came
 * from (the grounding Phase 26's hallucination guard requires), and a trait Critiq
 * can't ground in a real debrief is dropped at parse time.
 */

import { OBSERVATION_LENSES, type ObservationLens } from "@/lib/debrief/types";

/** Rep traits use the same pillar-themed lenses the debrief observations use. */
export type RepTraitLens = ObservationLens;
export const REP_TRAIT_LENSES = OBSERVATION_LENSES;

/**
 * One durable trait about how the rep sells, attributed to a debrief it was observed in.
 * The attribution is the point (same as the account fact): Phase 26 will only surface a
 * detail it can trace to a source interaction, so a trait with no valid source is
 * dropped at parse time.
 */
export interface RepTrait {
  /** The pattern, stated plainly (e.g. "Tends to move to next steps before surfacing implications"). */
  text: string;
  lens: RepTraitLens;
  /** The id of a debrief this trait is grounded in (must be one of the inputs). */
  sourceDebriefId: string;
}

/** The structured rep profile the model returns (already parsed + normalized). */
export interface RepConsolidationResult {
  /** One-line "how this rep is selling right now" (observational, not advice). */
  headline: string;
  /** The running profile prose — the rep's selling patterns, strengths, growth areas. */
  narrative: string;
  /** Attributed traits — the structured, source-tagged memory (sets up Phase 26). */
  traits: RepTrait[];
}

/**
 * One debrief as the rep consolidator reads it — the distilled Phase 20 structured
 * output (NOT the raw report), plus the account it was about (cross-account pattern
 * context). `label` is a short stable handle ("D1", "D2", …) the prompt shows the model
 * so it can attribute traits; the runner maps it back to the real `debriefId`.
 * `occurredAt` orders the history (newest first).
 */
export interface RepDebriefDigest {
  /** The real debrief id (what a trait's sourceDebriefId resolves to). */
  debriefId: string;
  /** Short handle shown in the prompt and used for attribution ("D1", "D2", …). */
  label: string;
  occurredAt: Date;
  /** The account this call was with — so the model can see cross-account patterns. */
  accountName: string;
  recap: string | null;
  observations: { note: string; lens: RepTraitLens }[];
  commitments: string[];
  openQuestions: string[];
  summary: string | null;
}

/** The context assembled for a single rep consolidation. */
export interface RepConsolidationContext {
  /** The rep's completed debriefs, NEWEST FIRST (most recent = most relevant). */
  debriefs: RepDebriefDigest[];
  /**
   * How many OLDER completed debriefs were not included (token budget). 0 when the full
   * history fits. Disclosed in the prompt so the model knows its view is partial.
   */
  truncatedOlderCount: number;
}

/** A generator that turns a RepConsolidationContext into a RepConsolidationResult (DI seam). */
export interface RepConsolidationGenerator {
  generate(context: RepConsolidationContext): Promise<RepConsolidationResult>;
}

/**
 * How many of the most-recent completed debriefs feed a single rep consolidation. The
 * profile reflects RECENT selling behavior (older patterns fade); older debriefs beyond
 * this are disclosed as a count, not silently dropped. Bounds the prompt size (working-
 * memory token discipline is Phase 25; this is a simple cap).
 */
export const MAX_DEBRIEFS_PER_REP_CONSOLIDATION = 20;

/**
 * The locked cadence: a rep's profile is (re)generated every Nth completed debrief
 * (10, 20, 30, …) — NOT after every debrief (that's the account summary). Below the
 * first interval the static intake profile carries the rep; there's no learned profile
 * yet.
 */
export const REP_CONSOLIDATION_INTERVAL = 10;
