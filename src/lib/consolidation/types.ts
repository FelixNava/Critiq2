/**
 * Account consolidation types (Phase 23 — the SEMANTIC memory tier for accounts).
 *
 * The locked memory architecture has three tiers: Episodic (raw interactions, stored
 * forever) → Semantic (running summaries, regenerated event-based) → Working (loaded
 * into the prompt for the next call). Phase 23 builds the ACCOUNT side of the semantic
 * tier: after every debrief, a background job regenerates a single running summary for
 * the account from its episodic record (the completed Phase 20 debriefs).
 *
 * Account intelligence is SHARED across reps (the account is the first-class entity),
 * so consolidation is rep-agnostic: it reads ALL completed debriefs on the account and
 * produces ONE summary, with no rep-side identity in it (rep data stays isolated).
 *
 * The defining constraint is SOURCE ATTRIBUTION: every fact in the summary carries the
 * id of the debrief it came from. That is the grounding Phase 26's hallucination guard
 * will require — a fact Critiq can't trace to an originating interaction is one it must
 * not assert. So the consolidator is built to attribute (and we drop any fact it can't).
 */

import {
  OBSERVATION_LENSES,
  type ObservationLens,
} from "@/lib/debrief/types";

/** Account facts use the same pillar-themed lenses the debrief observations use. */
export type AccountFactLens = ObservationLens;
export const ACCOUNT_FACT_LENSES = OBSERVATION_LENSES;

/**
 * One durable fact about the account, attributed to the debrief it came from. The
 * attribution is the point: Phase 26 will only surface a personal detail if it traces
 * to a source interaction, so a fact with no valid source is dropped at parse time.
 */
export interface AccountFact {
  /** The fact, stated plainly (e.g. "Buyer's budget is approved through Q3"). */
  text: string;
  lens: AccountFactLens;
  /** The id of the debrief this fact is grounded in (must be one of the inputs). */
  sourceDebriefId: string;
}

/** The structured account summary the model returns (already parsed + normalized). */
export interface ConsolidationResult {
  /** One-line "where this account stands" the rep can skim. */
  headline: string;
  /** The running summary prose (also mirrored into account_records.summary). */
  narrative: string;
  /** Attributed facts — the structured, source-tagged memory (sets up Phase 26). */
  facts: AccountFact[];
}

/**
 * One debrief as the consolidator reads it — the distilled Phase 20 structured output
 * (NOT the raw report). `label` is a short stable handle ("D1", "D2", …) the prompt
 * shows the model so it can attribute facts; the runner maps it back to the real
 * `debriefId`. `occurredAt` orders the history (newest matters most for "where things
 * stand now").
 */
export interface DebriefDigest {
  /** The real debrief id (what a fact's sourceDebriefId resolves to). */
  debriefId: string;
  /** Short handle shown in the prompt and used for attribution ("D1", "D2", …). */
  label: string;
  occurredAt: Date;
  recap: string | null;
  observations: { note: string; lens: AccountFactLens }[];
  commitments: string[];
  openQuestions: string[];
  summary: string | null;
}

/** The context assembled for a single account consolidation. */
export interface ConsolidationContext {
  accountName: string;
  accountStage: string;
  /** The account's completed debriefs, NEWEST FIRST (most recent = most relevant). */
  debriefs: DebriefDigest[];
  /**
   * How many OLDER completed debriefs were not included (token budget). 0 when the
   * full history fits. Disclosed in the prompt so the model knows its view is partial.
   */
  truncatedOlderCount: number;
}

/** A generator that turns a ConsolidationContext into a ConsolidationResult (DI seam). */
export interface ConsolidationGenerator {
  generate(context: ConsolidationContext): Promise<ConsolidationResult>;
}

/**
 * How many of the most-recent completed debriefs feed a single consolidation. Bounds
 * the prompt size (working-memory token discipline is Phase 25; this is a simple cap).
 * Older debriefs beyond this are disclosed as a count, not silently dropped.
 */
export const MAX_DEBRIEFS_PER_CONSOLIDATION = 20;
