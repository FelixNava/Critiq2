/**
 * Working memory assembly types (Phase 25 — the WORKING tier of the locked memory
 * architecture).
 *
 * The three tiers: Episodic (raw interactions, stored forever) → Semantic (running
 * summaries: account, Phase 23; rep, Phase 24) → **Working** (what actually gets loaded
 * into the prompt for the next call). Phase 25 is that last step: a pure builder that
 * assembles, under a per-call token budget,
 *
 *     rubric (methodology) + rep profile + this account's profile + last N raw interactions
 *
 * into a working set ready to hand to a Claude call. Per CLAUDE.md "AI Pipeline":
 * "Working memory = rep profile + this account profile + last 3 raw interactions + rubric".
 *
 * Crucially, the output is split to match the locked CACHE architecture (src/lib/ai/cache.ts):
 *   - `stableLayers` — methodology (cached forever) + rep profile (cached per rep). These
 *     are byte-stable across calls for the same rep → they go to `buildCachedSystem(...)`.
 *   - `volatileContext` — the account summary + the recent raw interactions. These change
 *     frequently → they go in the per-call user message, never cached.
 *
 * Phase 25 builds + tests this primitive; wiring the existing AI consumers (pre-call brief,
 * script, debrief, coaching) onto it is a follow-up (flagged) — the same build-the-layer-
 * then-adopt approach Phase 17 took with the cache helper.
 *
 * No new table, no migration, no API route, no UI: this module only READS the existing
 * semantic + episodic tables and assembles text. Additive — zero data-loss risk.
 */

import type { DebriefReport } from "@/lib/debrief/types";

/** Where the rep-profile layer came from (cold-start visibility, not just a string). */
export type RepProfileSource =
  /** The learned rep summary (rep_summaries, Phase 24) — the rep crossed 10+ debriefs. */
  | "learned"
  /** The static intake profile (Phase 18) — no learned profile yet (cold start). */
  | "intake"
  /** Neither exists yet — a brand-new rep with no intake answers. */
  | "none";

/**
 * One raw past interaction (episodic) the working set carries for continuity — the rep's
 * verbatim guided report from a completed debrief. "Raw" is the point: this is what
 * happened in the rep's own words, not the distilled semantic summary.
 */
export interface RawInteraction {
  /** The debrief this raw report came from (provenance / source-tagging for Phase 26). */
  debriefId: string;
  /** When the call happened (orders the interactions, newest first). */
  occurredAt: Date;
  /** The rep's verbatim guided answers (the episodic source of truth). */
  report: DebriefReport;
}

/**
 * The raw materials a working set is assembled from. The builder (build.ts) reads these
 * from the DB; the assembler (assemble.ts) is pure and takes them as input so it's unit-
 * tested without a database.
 */
export interface WorkingMemorySources {
  /** The locked SPIN/Voss/Navarro methodology block (always present — the foundation). */
  methodology: string;
  /** The rep-profile block (learned summary OR static intake), or null at full cold start. */
  repProfile: string | null;
  /** Which source repProfile came from. */
  repProfileSource: RepProfileSource;
  /** The formatted account semantic-summary block (Phase 23), or null at cold start. */
  accountSummary: string | null;
  /** This rep's recent raw interactions WITH THIS ACCOUNT, newest first (already capped). */
  rawInteractions: RawInteraction[];
  /**
   * How many OLDER completed debriefs exist beyond the cap that were not even fetched. The
   * budget may trim further; this is the "beyond maxRawInteractions" portion, disclosed so
   * the cap is never silent (project rule: no silent caps).
   */
  olderInteractionsOmitted: number;
}

/** Options controlling the assembly (all optional — sensible defaults in budget.ts). */
export interface WorkingMemoryOptions {
  /** Total token budget for the assembled working set. Default DEFAULT_WORKING_MEMORY_BUDGET. */
  tokenBudget?: number;
  /** Max raw interactions to include before the budget squeeze. Default DEFAULT_MAX_RAW_INTERACTIONS. */
  maxRawInteractions?: number;
}

/** Per-layer accounting for the manifest (estimated size + whether it made the cut). */
export interface WorkingMemoryLayerInfo {
  name: "methodology" | "repProfile" | "accountSummary" | "rawInteractions";
  estimatedTokens: number;
  included: boolean;
  /** True when this layer's text was shortened to fit the budget. */
  truncated: boolean;
}

/**
 * A transparent record of what the assembler did — every inclusion, trim, and truncation,
 * plus the token math. Callers log this (counts only, no PII) so a budget squeeze is
 * always visible rather than a silent drop.
 */
export interface WorkingMemoryManifest {
  repProfileSource: RepProfileSource;
  /** Raw interactions that made it into the working set. */
  rawInteractionsIncluded: number;
  /** Raw interactions dropped entirely (older-than-cap + budget-dropped, combined). */
  rawInteractionsDropped: number;
  /** Raw interactions whose bodies were shortened to fit. */
  rawInteractionsTruncated: number;
  accountSummaryIncluded: boolean;
  accountSummaryTruncated: boolean;
  /** Estimated tokens of the FULL assembled set (stable + volatile). */
  estimatedTokens: number;
  tokenBudget: number;
  /** False when even the foundation (methodology + rep profile) alone exceeds the budget. */
  withinBudget: boolean;
  layers: WorkingMemoryLayerInfo[];
}

/** The assembled working set, ready to drive a Claude call. */
export interface WorkingMemory {
  /**
   * Stable, cacheable layers in cache order (methodology first, then rep profile). Pass
   * straight to `buildCachedSystem(workingMemory.stableLayers)`. Empty-text layers are
   * already dropped.
   */
  stableLayers: { text: string; cache?: boolean }[];
  /**
   * The volatile working context — the account summary + recent raw interactions — as one
   * text block for the per-call user message. Empty string when there's no volatile
   * context yet (cold-start account, no prior interactions).
   */
  volatileContext: string;
  manifest: WorkingMemoryManifest;
}
