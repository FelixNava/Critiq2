/**
 * Pure scoring orchestration (Phase 16) — no DB, no network, fully
 * dependency-injected so it unit-tests with a fake Scorer. It takes the model's
 * raw judgement and turns it into a trustworthy, bounded ScoreResult:
 *
 *   1. For every rubric dimension (in rubric order), read the model's score,
 *      CLAMP it to [0, maxPoints], and annotate it with the rubric metadata.
 *      A dimension the model omitted defaults to 0 and trips `partialJudgement`.
 *   2. Aggregate each pillar = sum of its clamped sub-dimension scores.
 *   3. Overall = sum of the three pillars (guaranteed 0–100 because the clamped
 *      sub-dimensions can't exceed their maxes and the maxes sum to 100).
 *
 * The clamping is the guardrail: the model can hallucinate a 99/10, but the
 * stored score is always rubric-valid. This separates "what the model said"
 * (kept verbatim in evidence/rationale) from "the number we trust".
 */

import {
  DIMENSIONS,
  OVERALL_MAX,
  PILLARS,
  type PillarKey,
} from "./rubric";
import type {
  PillarScore,
  ScorableTranscript,
  ScoredDimension,
  ScoreResult,
  Scorer,
} from "./types";

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/**
 * Aggregate a raw judgement into a bounded, rubric-valid ScoreResult. Pure —
 * exported separately from `scoreTranscript` so tests can feed a hand-built raw
 * result and assert the math without any Scorer at all.
 */
export function aggregateRawScore(
  raw: {
    dimensions: Record<string, { score: number; rationale: string; evidence: string[] }>;
    overallStrengths: string[];
    overallImprovements: string[];
    summary: string;
  },
): ScoreResult {
  let partialJudgement = false;
  const dimensions: ScoredDimension[] = [];
  const pillarTotals: Record<PillarKey, number> = { spin: 0, voss: 0, navarro: 0 };

  for (const d of DIMENSIONS) {
    const got = raw.dimensions[d.key];
    if (!got) partialJudgement = true;
    const clamped = clamp(Math.round(got?.score ?? 0), 0, d.maxPoints);
    pillarTotals[d.pillar] += clamped;
    dimensions.push({
      key: d.key,
      pillar: d.pillar,
      name: d.name,
      maxPoints: d.maxPoints,
      score: clamped,
      rationale: got?.rationale ?? "",
      evidence: got?.evidence ?? [],
    });
  }

  const pillars = {} as Record<PillarKey, PillarScore>;
  let overall = 0;
  for (const pk of Object.keys(PILLARS) as PillarKey[]) {
    const p = PILLARS[pk];
    pillars[pk] = {
      key: pk,
      name: p.name,
      score: pillarTotals[pk],
      maxPoints: p.maxPoints,
    };
    overall += pillarTotals[pk];
  }

  return {
    // Defensive: clamp the sum too, though it can't exceed OVERALL_MAX given the
    // per-dimension clamps and the rubric integrity assertion.
    overall: clamp(overall, 0, OVERALL_MAX),
    pillars,
    dimensions,
    overallStrengths: raw.overallStrengths,
    overallImprovements: raw.overallImprovements,
    summary: raw.summary,
    partialJudgement,
  };
}

/**
 * Score a transcript end-to-end (still pure of DB/network — the Scorer is
 * injected). The caller is responsible for persistence + access control.
 */
export async function scoreTranscript(
  transcript: ScorableTranscript,
  scorer: Scorer,
): Promise<ScoreResult> {
  const raw = await scorer.score(transcript);
  return aggregateRawScore(raw);
}
