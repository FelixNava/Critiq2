/**
 * Coaching orchestration (Phase 21 — the Coaching Output Layer). Loads the completed
 * Phase 20 debrief + the account + rep profile, and — when the debrief is linked to a
 * recorded call that has a completed Phase 16 score — loads + snapshots that
 * objective score. Then runs the generator synchronously and persists the result.
 * Dependency-injected generator so the flow is unit-testable without a network call.
 *
 * Coaching is generated FROM a debrief (mirrors a script generated from a brief): the
 * subjective account comes from the debrief, the objective half from the linked
 * score. Most beta debriefs are of un-recorded calls (no recordingId / no score) →
 * coaching proceeds debrief-only, and the score block is simply absent.
 */

import { getAccountForUser } from "@/lib/accounts";
import { formatCacheUsage, type CacheUsageSummary } from "@/lib/ai/cache";
import { getDebriefForUser } from "@/lib/debrief/store";
import type {
  DebriefObservation,
} from "@/lib/debrief/types";
import { buildRepProfileBlock } from "@/lib/precall/repProfile";
import { getScoreForRecording } from "@/lib/scoring/store";
import { AnthropicGuardVerifier } from "@/lib/hallucinationguard/anthropic";
import { formatGuardManifest } from "@/lib/hallucinationguard/guard";
import { resolveGuardMode } from "@/lib/hallucinationguard/policy";
import { buildGroundedSources } from "@/lib/hallucinationguard/sources";
import type { GuardVerifier } from "@/lib/hallucinationguard/types";
import { AnthropicCoachingGenerator } from "./anthropic";
import { guardCoachingResult } from "./guard";
import { createCoaching, failCoaching, finishCoaching } from "./store";
import type {
  CoachingContext,
  CoachingGenerator,
  CoachingResult,
  CoachingScoreInput,
  ScoreSnapshot,
} from "./types";

export type GenerateCoachingOutcome =
  | { status: "completed"; coachingId: string }
  | { status: "not-found" }
  | { status: "debrief-not-ready" }
  | { status: "failed"; coachingId: string; error: string };

export interface GenerateCoachingInput {
  userId: string;
  accountId: string;
  debriefId: string;
}

export interface GenerateCoachingDeps {
  generator?: CoachingGenerator;
  nowMs?: number;
  /** Phase 26 hallucination-guard verifier (DI for tests). Defaults to the Claude verifier. */
  guardVerifier?: GuardVerifier;
}

/** Coerce a jsonb string-array column to a clean string[] (drop empties/non-strings). */
function toStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) out.push(item.trim());
  }
  return out;
}

/**
 * Build the objective-score input from a completed score row. Returns null if the
 * recording isn't linked or the score isn't completed (coach from the debrief alone).
 * Exported + pure for unit testing the snapshot shaping without a DB.
 */
export function buildScoreInput(
  score: {
    status: string;
    overallScore: number | null;
    spinScore: number | null;
    vossScore: number | null;
    navarroScore: number | null;
    strengths: unknown;
    improvements: unknown;
    partialJudgement: boolean;
  } | null,
): CoachingScoreInput | null {
  if (!score || score.status !== "completed") return null;
  const snapshot: ScoreSnapshot = {
    overall: score.overallScore ?? 0,
    spin: score.spinScore ?? 0,
    voss: score.vossScore ?? 0,
    navarro: score.navarroScore ?? 0,
    partialJudgement: score.partialJudgement,
  };
  return {
    snapshot,
    strengths: toStringList(score.strengths),
    improvements: toStringList(score.improvements),
  };
}

/**
 * Generate and persist coaching for one of the rep's completed debriefs.
 *
 * - 'not-found': the rep isn't assigned to the account, or the debrief isn't theirs /
 *   belongs to a different account.
 * - 'debrief-not-ready': the debrief exists but isn't completed (nothing to coach on).
 * - 'failed': the model/parse failed; the row is marked failed and persists.
 */
export async function generateCoachingForDebrief(
  input: GenerateCoachingInput,
  deps: GenerateCoachingDeps = {},
): Promise<GenerateCoachingOutcome> {
  const account = await getAccountForUser(input.userId, input.accountId);
  if (!account) return { status: "not-found" };

  const debrief = await getDebriefForUser(input.userId, input.debriefId);
  // The debrief must be the rep's AND belong to the account in the route (no
  // cross-account coaching via a guessed debrief id).
  if (!debrief || debrief.accountId !== input.accountId) {
    return { status: "not-found" };
  }
  if (debrief.status !== "completed") {
    return { status: "debrief-not-ready" };
  }

  // The objective half: only when the debrief links a recorded, scored call.
  let scoreInput: CoachingScoreInput | null = null;
  let scoreId: string | null = null;
  if (debrief.recordingId) {
    const score = await getScoreForRecording(debrief.recordingId);
    scoreInput = buildScoreInput(score);
    if (scoreInput && score) scoreId = score.id;
  }

  const repProfile = await buildRepProfileBlock(input.userId);

  const context: CoachingContext = {
    accountName: account.name,
    accountStage: account.stage,
    accountSummary: account.summary,
    debrief: {
      recap: debrief.recap,
      observations: (debrief.observations as DebriefObservation[]) ?? [],
      commitments: toStringList(debrief.commitments),
      openQuestions: toStringList(debrief.openQuestions),
      summary: debrief.summary,
    },
    score: scoreInput,
    repProfile,
  };

  const coachingId = await createCoaching(
    {
      debriefId: input.debriefId,
      accountId: input.accountId,
      userId: input.userId,
      recordingId: debrief.recordingId,
      scoreId,
      scoreSnapshot: scoreInput?.snapshot ?? null,
    },
    deps.nowMs,
  );

  const generator =
    deps.generator ??
    new AnthropicCoachingGenerator({
      onUsage: (usage: CacheUsageSummary) => {
        // Phase 17 telemetry: log the methodology+rep-profile cache hit rate
        // (counts only, no PII). Visible in the Vercel runtime logs.
        console.log(`[coaching] ${coachingId} ${formatCacheUsage(usage)}`);
      },
    });

  try {
    const result = await generator.generate(context);
    // Phase 26 — hallucination guard: strip unsourced personal references BEFORE the rep
    // sees the coaching (the locked credibility guardrail). Conservative by default; the
    // grounded corpus is the source-tagged facts/traits/raw interactions for THIS rep+account
    // (P23/P24/P25). Fail-safe: a guard error never fails coaching — it ships unguarded with a
    // logged warning rather than dropping the rep's result. No schema change; manifest logged.
    const finalResult = await applyHallucinationGuard(
      result,
      input.userId,
      input.accountId,
      { name: account.name, summary: account.summary },
      coachingId,
      deps.guardVerifier,
    );
    await finishCoaching(coachingId, finalResult);
    return { status: "completed", coachingId };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await failCoaching(coachingId, error);
    return { status: "failed", coachingId, error };
  }
}

/**
 * Run the coaching through the Phase 26 hallucination guard. Returns the guarded result on
 * success, or the ORIGINAL result if anything in the guard path throws (fail-safe — the rep
 * still gets coaching). Logs the guard manifest (counts only, no PII — Phase 17 posture).
 */
async function applyHallucinationGuard(
  result: CoachingResult,
  userId: string,
  accountId: string,
  identity: { name?: string | null; summary?: string | null },
  coachingId: string,
  injectedVerifier?: GuardVerifier,
): Promise<CoachingResult> {
  try {
    const sources = await buildGroundedSources(userId, accountId, identity);
    const verifier =
      injectedVerifier ??
      new AnthropicGuardVerifier({
        onUsage: (usage: CacheUsageSummary) =>
          console.log(`[coaching-guard] ${coachingId} ${formatCacheUsage(usage)}`),
      });
    const guarded = await guardCoachingResult(result, sources, {
      mode: resolveGuardMode(),
      verifier,
    });
    console.log(
      `[coaching-guard] ${coachingId} ${formatGuardManifest(guarded.manifest)} ` +
        `prioritiesDropped=${guarded.prioritiesDropped} reinforceDropped=${guarded.reinforcementsDropped}`,
    );
    return guarded.result;
  } catch (e) {
    console.warn(
      `[coaching-guard] ${coachingId} guard skipped (shipping unguarded): ` +
        `${e instanceof Error ? e.message : String(e)}`,
    );
    return result;
  }
}
