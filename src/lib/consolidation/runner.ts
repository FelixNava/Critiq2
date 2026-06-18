/**
 * Account consolidation runner (Phase 23) — ties the pure prompt/parse engine to the
 * DB store + the real Claude generator. Used by BOTH the cron sweeper and the
 * best-effort post-debrief trigger, so the count → claim → generate → persist
 * lifecycle lives in exactly one place. Mirrors src/lib/scoring/runner.ts.
 *
 * Lifecycle: count the account's completed debriefs → claim the summary row
 * (idempotent; new material resets the attempts budget) → read the newest debriefs and
 * label them D1… → generate (the model attributes each fact to a label) → map the
 * surviving labels back to real debrief ids → persist (and mirror the narrative into
 * account_records.summary). Any throw before a result marks the row failed; the cron
 * retries up to the cap, and a fresh debrief resets it.
 */

import { formatCacheUsage, type CacheUsageSummary } from "@/lib/ai/cache";
import { AnthropicConsolidationGenerator } from "./anthropic";
import {
  claimConsolidation,
  countCompletedDebriefs,
  failConsolidation,
  finishConsolidation,
  getCompletedDebriefsForConsolidation,
} from "./store";
import {
  MAX_DEBRIEFS_PER_CONSOLIDATION,
  type AccountFact,
  type ConsolidationContext,
  type ConsolidationGenerator,
  type DebriefDigest,
} from "./types";

export type ConsolidationOutcome =
  | { status: "completed"; summaryId: string; factCount: number }
  | { status: "skipped"; summaryId: string; reason: "current" | "in-progress" | "exhausted" }
  | { status: "no-debriefs"; accountId: string } // nothing consolidatable yet
  | { status: "failed"; summaryId: string; error: string };

export interface ConsolidationRunnerDeps {
  generator?: ConsolidationGenerator;
  /** Account name + stage for the prompt (the caller usually has them; else fetched). */
  account?: { name: string; stage: string };
  nowMs?: number;
}

/** Stable label for the nth-newest debrief shown in the prompt ("D1", "D2", …). */
function labelFor(index: number): string {
  return `D${index + 1}`;
}

/**
 * Consolidate one account end-to-end. Caller must have already authorized the
 * trigger (an owner just debriefed the account, or the cron secret).
 */
export async function runConsolidationForAccount(
  accountId: string,
  deps: ConsolidationRunnerDeps = {},
): Promise<ConsolidationOutcome> {
  const completedCount = await countCompletedDebriefs(accountId);
  if (completedCount === 0) {
    // Nothing to consolidate yet (e.g. the only debriefs are in-flight/failed).
    return { status: "no-debriefs", accountId };
  }

  const claim = await claimConsolidation(accountId, completedCount, deps.nowMs);
  if (!claim.claimed) {
    return { status: "skipped", summaryId: claim.summaryId, reason: claim.reason };
  }
  const summaryId = claim.summaryId;

  try {
    const account = deps.account ?? (await fetchAccountMeta(accountId));

    const rows = await getCompletedDebriefsForConsolidation(
      accountId,
      MAX_DEBRIEFS_PER_CONSOLIDATION,
    );
    // Label the debriefs (newest-first) and keep a label → real-id map for re-attribution.
    const labelToId = new Map<string, string>();
    const debriefs: DebriefDigest[] = rows.map((r, i) => {
      const label = labelFor(i);
      labelToId.set(label, r.debriefId);
      return { ...r, label };
    });
    const truncatedOlderCount = Math.max(0, completedCount - debriefs.length);

    const context: ConsolidationContext = {
      accountName: account.name,
      accountStage: account.stage,
      debriefs,
      truncatedOlderCount,
    };

    const generator =
      deps.generator ??
      new AnthropicConsolidationGenerator({
        onUsage: (usage: CacheUsageSummary) => {
          // Phase 17 telemetry: log the methodology cache hit rate (counts only, no PII).
          console.log(`[consolidation] account=${accountId} ${formatCacheUsage(usage)}`);
        },
      });

    const result = await generator.generate(context);

    // Re-attribute: the model's sourceDebriefId is a label; map it back to the real
    // debrief id. parseConsolidationJson already dropped facts with unknown labels, so
    // every surviving fact resolves — but guard defensively all the same.
    const facts: AccountFact[] = [];
    for (const f of result.facts) {
      const realId = labelToId.get(f.sourceDebriefId);
      if (!realId) continue;
      facts.push({ ...f, sourceDebriefId: realId });
    }

    await finishConsolidation(summaryId, accountId, {
      headline: result.headline,
      narrative: result.narrative,
      facts,
      // The high-water mark is the TOTAL completed count (not the capped read count),
      // so a fully-consolidated account isn't re-picked forever when > cap debriefs exist.
      debriefCount: completedCount,
      consolidatedThroughAt: debriefs[0]?.occurredAt ?? null,
    });
    return { status: "completed", summaryId, factCount: facts.length };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await failConsolidation(summaryId, error);
    return { status: "failed", summaryId, error };
  }
}

/** Minimal account metadata for the prompt (name + stage), or sensible fallbacks. */
async function fetchAccountMeta(
  accountId: string,
): Promise<{ name: string; stage: string }> {
  const { db } = await import("@/db");
  const { accountsTbl } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const [row] = await db
    .select({ name: accountsTbl.name, stage: accountsTbl.stage })
    .from(accountsTbl)
    .where(eq(accountsTbl.id, accountId))
    .limit(1);
  return { name: row?.name ?? "this account", stage: row?.stage ?? "prospecting" };
}
