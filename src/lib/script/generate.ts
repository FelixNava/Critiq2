/**
 * Call-script orchestration (Phase 19). Loads the completed Phase 18 brief + the
 * account + rep profile, snapshots the in-force objective, runs the generator
 * synchronously, and persists the result. Dependency-injected generator so the flow
 * is unit-testable without a network call.
 *
 * The script is generated FROM a brief: the objective + diagnosis + approach +
 * objections all come from the brief the rep already prepared. This keeps the prep
 * loop coherent (brief → script) and the objective HARD RULE (Phase 18) the single
 * source of the objective — the script never re-derives it.
 */

import { getAccountForUser } from "@/lib/accounts";
import { formatCacheUsage, type CacheUsageSummary } from "@/lib/ai/cache";
import { getBriefForUser } from "@/lib/precall/store";
import { buildConsumerWorkingMemory } from "@/lib/workingmemory/forConsumer";
import { AnthropicScriptGenerator } from "./anthropic";
import { coerceStyleMode, type StyleMode } from "./style";
import { createScript, failScript, finishScript } from "./store";
import type { ScriptContext, ScriptGenerator } from "./types";

export type GenerateScriptOutcome =
  | { status: "completed"; scriptId: string; styleMode: StyleMode }
  | { status: "not-found" }
  | { status: "brief-not-ready" }
  | { status: "no-objective" }
  | { status: "failed"; scriptId: string; error: string };

export interface GenerateScriptInput {
  userId: string;
  accountId: string;
  briefId: string;
  styleMode: StyleMode;
}

export interface GenerateScriptDeps {
  generator?: ScriptGenerator;
  nowMs?: number;
}

/**
 * Generate and persist a call script for a rep-owned account, from one of the rep's
 * completed briefs on that account.
 *
 * - 'not-found': the rep isn't assigned to the account, or the brief isn't theirs /
 *   belongs to a different account.
 * - 'brief-not-ready': the brief exists but isn't completed (no diagnosis/objective).
 * - 'no-objective': the brief has no in-force objective to script toward.
 * - 'failed': the model/parse failed; the row is marked failed and persists.
 */
export async function generateScriptForBrief(
  input: GenerateScriptInput,
  deps: GenerateScriptDeps = {},
): Promise<GenerateScriptOutcome> {
  const account = await getAccountForUser(input.userId, input.accountId);
  if (!account) return { status: "not-found" };

  const brief = await getBriefForUser(input.userId, input.briefId);
  // The brief must be the rep's AND belong to the account in the route (no
  // cross-account script generation via a guessed brief id).
  if (!brief || brief.accountId !== input.accountId) {
    return { status: "not-found" };
  }
  if (brief.status !== "completed") {
    return { status: "brief-not-ready" };
  }

  const objective = (brief.objective ?? "").trim();
  if (!objective) {
    return { status: "no-objective" };
  }

  const styleMode = coerceStyleMode(input.styleMode);

  // Phase 35c — wire in working memory (richer rep profile + the volatile memory context).
  // The rep is already authorized (account check above), so the account is passed in.
  const wm = await buildConsumerWorkingMemory(input.userId, input.accountId, {
    name: account.name,
    summary: account.summary,
  });
  console.log(
    `[script] wm rep=${wm.repProfileSource} ` +
      `raw=${wm.manifest.rawInteractionsIncluded} ` +
      `ctxChars=${wm.memoryContext.length} within=${wm.manifest.withinBudget}`,
  );

  const context: ScriptContext = {
    accountName: account.name,
    accountStage: account.stage,
    accountSummary: account.summary,
    memoryContext: wm.memoryContext,
    objective,
    diagnosis: brief.diagnosis,
    approach:
      (brief.approach as ScriptContext["approach"] | null) ?? [],
    objections:
      (brief.objections as ScriptContext["objections"] | null) ?? [],
    styleMode,
    repProfile: wm.repProfile,
  };

  const scriptId = await createScript(
    {
      briefId: input.briefId,
      accountId: input.accountId,
      userId: input.userId,
      styleMode,
      objective,
    },
    deps.nowMs,
  );

  const generator =
    deps.generator ??
    new AnthropicScriptGenerator({
      onUsage: (usage: CacheUsageSummary) => {
        // Phase 17 telemetry: log the methodology+rep-profile cache hit rate
        // (counts only, no PII). Visible in the Vercel runtime logs.
        console.log(`[script] script ${scriptId} ${formatCacheUsage(usage)}`);
      },
    });

  try {
    const result = await generator.generate(context);
    await finishScript(scriptId, result);
    return { status: "completed", scriptId, styleMode };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await failScript(scriptId, error);
    return { status: "failed", scriptId, error };
  }
}
