/**
 * Scoring types (Phase 16 — three-pillar SPIN/Voss/Navarro engine).
 *
 * Like the transcription layer (Phase 15), the orchestration is pure +
 * dependency-injected: `scoreTranscript` takes a `Scorer` (the thing that turns
 * a transcript → a raw model judgement) so it unit-tests with a fake (no network,
 * no Anthropic call). The real Claude round-trip is the runtime gate Felix +
 * the expert coach validate; the engine math (clamping, aggregation, integrity)
 * is proven deterministically.
 */

import type { PillarKey } from "./rubric";

/** What the transcript the engine scores looks like (the slice it needs). */
export interface ScorableTranscript {
  /** The unified transcript text. */
  text: string;
  /** completed | partial — partial still scores (some text beats none), flagged. */
  status: string;
  wordCount: number | null;
}

/** One sub-dimension's judgement as returned by the model. */
export interface DimensionScore {
  /** Raw score the model gave (validated/clamped to [0, maxPoints] by the engine). */
  score: number;
  /** One-sentence justification. */
  rationale: string;
  /**
   * Short verbatim transcript quotes that support the score. Grounding for the
   * Phase 26 hallucination guard — a score should be traceable to what was said.
   */
  evidence: string[];
}

/** The raw judgement a Scorer returns (pre-aggregation, pre-clamp). */
export interface RawScoreResult {
  /** Keyed by dimension key (see rubric DIMENSION_KEYS). */
  dimensions: Record<string, DimensionScore>;
  /** Call-level coaching seeds (Phase 21 consumes these). */
  overallStrengths: string[];
  overallImprovements: string[];
  /** A one-paragraph plain-language summary of the call. */
  summary: string;
}

/**
 * Turns a transcript into a raw judgement. The real implementation calls Claude;
 * tests pass a fake. `language` is forwarded for future locale handling.
 */
export interface Scorer {
  score(transcript: ScorableTranscript): Promise<RawScoreResult>;
}

/** A clamped sub-dimension score + its ceiling (engine output). */
export interface ScoredDimension extends DimensionScore {
  key: string;
  pillar: PillarKey;
  name: string;
  maxPoints: number;
}

/** Per-pillar aggregate. */
export interface PillarScore {
  key: PillarKey;
  name: string;
  score: number;
  maxPoints: number;
}

/** The full, validated, aggregated result the engine produces. */
export interface ScoreResult {
  /** 0–100, the sum of the three pillar scores. */
  overall: number;
  pillars: Record<PillarKey, PillarScore>;
  /** Every sub-dimension, clamped + annotated, in rubric order. */
  dimensions: ScoredDimension[];
  overallStrengths: string[];
  overallImprovements: string[];
  summary: string;
  /**
   * True when the model omitted a sub-dimension and the engine defaulted it to 0
   * (a degraded judgement — surfaced so a consumer can flag it). Never throws.
   */
  partialJudgement: boolean;
}
