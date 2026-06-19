/**
 * Post-call debrief orchestration (Phase 20 — Reporter Mode). Assembles the context
 * (account + shared summary + rep profile + the rep's guided report), creates the
 * row, runs the generator synchronously, and persists the result. Dependency-injected
 * generator so the flow is unit-testable without a network call.
 */

import { getAccountForUser } from "@/lib/accounts";
import { formatCacheUsage, type CacheUsageSummary } from "@/lib/ai/cache";
import { AnthropicDebriefGenerator } from "./anthropic";
import { buildRepProfileBlock } from "@/lib/precall/repProfile";
import { buildConsumerWorkingMemory } from "@/lib/workingmemory/forConsumer";
import { hasNarrative } from "./reporter";
import { createDebrief, failDebrief, finishDebrief } from "./store";
import type {
  DebriefContext,
  DebriefGenerator,
  DebriefReport,
} from "./types";

export type GenerateOutcome =
  | { status: "completed"; debriefId: string }
  | { status: "not-found" }
  | { status: "failed"; debriefId: string; error: string };

export interface GenerateInput {
  userId: string;
  accountId: string;
  report: DebriefReport;
  recordingId?: string | null;
  briefId?: string | null;
}

export interface GenerateDeps {
  generator?: DebriefGenerator;
  nowMs?: number;
}

/**
 * Generate and persist a debrief for a rep-owned account. Returns 'not-found' if the
 * rep isn't assigned to the account (the access boundary lives in getAccountForUser).
 * On a model/parse failure the row is marked failed and the error is returned (the
 * route maps it to a 502); the row persists for history.
 */
export async function generateDebriefForAccount(
  input: GenerateInput,
  deps: GenerateDeps = {},
): Promise<GenerateOutcome> {
  const account = await getAccountForUser(input.userId, input.accountId);
  if (!account) return { status: "not-found" };

  // Phase 35c — wire in working memory (richer rep profile + the volatile memory context).
  // The memory context is BACKGROUND for organizing the report; the reporter's honesty rules
  // still bind the recap to what the rep reported for THIS call.
  const wm = await buildConsumerWorkingMemory(input.userId, input.accountId);
  const repProfile = wm?.repProfile ?? (await buildRepProfileBlock(input.userId));
  if (wm) {
    console.log(
      `[debrief] wm rep=${wm.repProfileSource} ` +
        `raw=${wm.manifest.rawInteractionsIncluded} ` +
        `ctxChars=${wm.memoryContext.length} within=${wm.manifest.withinBudget}`,
    );
  }

  const context: DebriefContext = {
    accountName: account.name,
    accountStage: account.stage,
    accountSummary: account.summary,
    memoryContext: wm?.memoryContext ?? null,
    report: input.report,
    repProfile,
  };

  const debriefId = await createDebrief(
    {
      accountId: input.accountId,
      userId: input.userId,
      report: input.report,
      recordingId: input.recordingId ?? null,
      briefId: input.briefId ?? null,
    },
    deps.nowMs,
  );

  const generator =
    deps.generator ??
    new AnthropicDebriefGenerator({
      onUsage: (usage: CacheUsageSummary) => {
        // Phase 17 telemetry: log the methodology+rep-profile cache hit rate
        // (counts only, no PII). Visible in the Vercel runtime logs.
        console.log(`[debrief] ${debriefId} ${formatCacheUsage(usage)}`);
      },
    });

  try {
    const result = await generator.generate(context);
    await finishDebrief(debriefId, result);
    return { status: "completed", debriefId };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await failDebrief(debriefId, error);
    return { status: "failed", debriefId, error };
  }
}

/** Re-export for the route's pre-flight guard (the one hard input requirement). */
export { hasNarrative };
