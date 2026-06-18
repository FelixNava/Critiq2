/**
 * Rep consolidation runner (Phase 24) — ties the pure prompt/parse engine to the DB
 * store + the real Claude generator. Used by BOTH the cron sweeper and the best-effort
 * post-debrief trigger, so the count → threshold → claim → generate → persist lifecycle
 * lives in exactly one place. Mirrors src/lib/consolidation/runner.ts.
 *
 * Lifecycle: count the rep's completed debriefs → compute the every-10 threshold (skip
 * if below the first interval) → claim the summary row (idempotent; a new threshold
 * resets the attempts budget) → read the newest debriefs across the rep's accounts and
 * label them D1… → generate (the model attributes each trait to a label) → map the
 * surviving labels back to real debrief ids → persist. Any throw before a result marks
 * the row failed; the cron retries up to the cap, and the next interval resets it.
 */

import { formatCacheUsage, type CacheUsageSummary } from "@/lib/ai/cache";
import { AnthropicRepConsolidationGenerator } from "./anthropic";
import {
  claimRepConsolidation,
  countCompletedDebriefsForRep,
  failRepConsolidation,
  finishRepConsolidation,
  getCompletedDebriefsForRepConsolidation,
  repConsolidationThreshold,
} from "./store";
import {
  MAX_DEBRIEFS_PER_REP_CONSOLIDATION,
  type RepConsolidationContext,
  type RepConsolidationGenerator,
  type RepDebriefDigest,
  type RepTrait,
} from "./types";

export type RepConsolidationOutcome =
  | { status: "completed"; summaryId: string; traitCount: number }
  | {
      status: "skipped";
      summaryId: string;
      reason: "current" | "in-progress" | "exhausted";
    }
  | { status: "below-threshold"; userId: string } // < the first interval — no profile yet
  | { status: "failed"; summaryId: string; error: string };

export interface RepConsolidationRunnerDeps {
  generator?: RepConsolidationGenerator;
  nowMs?: number;
}

/** Stable label for the nth-newest debrief shown in the prompt ("D1", "D2", …). */
function labelFor(index: number): string {
  return `D${index + 1}`;
}

/**
 * Consolidate one rep's profile end-to-end. Caller must have already authorized the
 * trigger (the rep just debriefed, or the cron secret).
 */
export async function runRepConsolidation(
  userId: string,
  deps: RepConsolidationRunnerDeps = {},
): Promise<RepConsolidationOutcome> {
  const completedCount = await countCompletedDebriefsForRep(userId);
  const threshold = repConsolidationThreshold(completedCount);
  if (threshold <= 0) {
    // Below the first interval — the static intake profile carries the rep for now.
    return { status: "below-threshold", userId };
  }

  const claim = await claimRepConsolidation(userId, threshold, deps.nowMs);
  if (!claim.claimed) {
    return { status: "skipped", summaryId: claim.summaryId, reason: claim.reason };
  }
  const summaryId = claim.summaryId;

  try {
    const rows = await getCompletedDebriefsForRepConsolidation(
      userId,
      MAX_DEBRIEFS_PER_REP_CONSOLIDATION,
    );
    // Label the debriefs (newest-first) and keep a label → real-id map for re-attribution.
    const labelToId = new Map<string, string>();
    const debriefs: RepDebriefDigest[] = rows.map((r, i) => {
      const label = labelFor(i);
      labelToId.set(label, r.debriefId);
      return { ...r, label };
    });
    const truncatedOlderCount = Math.max(0, completedCount - debriefs.length);

    const context: RepConsolidationContext = {
      debriefs,
      truncatedOlderCount,
    };

    const generator =
      deps.generator ??
      new AnthropicRepConsolidationGenerator({
        onUsage: (usage: CacheUsageSummary) => {
          // Phase 17 telemetry: log the methodology cache hit rate (counts only, no PII).
          console.log(`[rep-consolidation] rep=${userId} ${formatCacheUsage(usage)}`);
        },
      });

    const result = await generator.generate(context);

    // Re-attribute: the model's sourceDebriefId is a label; map it back to the real
    // debrief id. parseRepConsolidationJson already dropped traits with unknown labels,
    // so every surviving trait resolves — but guard defensively all the same.
    const traits: RepTrait[] = [];
    for (const t of result.traits) {
      const realId = labelToId.get(t.sourceDebriefId);
      if (!realId) continue;
      traits.push({ ...t, sourceDebriefId: realId });
    }

    await finishRepConsolidation(summaryId, {
      headline: result.headline,
      narrative: result.narrative,
      traits,
      // Store the every-10 threshold this profile reflects (NOT the raw count) so the
      // next regeneration only fires when the rep crosses the next interval.
      debriefCount: threshold,
      consolidatedThroughAt: debriefs[0]?.occurredAt ?? null,
    });
    return { status: "completed", summaryId, traitCount: traits.length };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await failRepConsolidation(summaryId, error);
    return { status: "failed", summaryId, error };
  }
}
