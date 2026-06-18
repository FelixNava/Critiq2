/**
 * Pre-call brief orchestration (Phase 18). Assembles the context (account + shared
 * summary + rep profile + the rule-derived objective mode), creates the row, runs
 * the generator synchronously, and persists the result. Dependency-injected
 * generator so the flow is unit-testable without a network call.
 *
 * The objective MODE is computed here from the interaction count via the pure rule
 * (resolveObjectiveMode) — never from the model. The model only RECOMMENDS the
 * objective text when the rule says it leads (interaction 3+).
 */

import { getAccountForUser } from "@/lib/accounts";
import { formatCacheUsage, type CacheUsageSummary } from "@/lib/ai/cache";
import { AnthropicBriefGenerator } from "./anthropic";
import {
  nextInteractionNumber,
  resolveObjectiveMode,
  type ObjectiveMode,
} from "./objective";
import { buildRepProfileBlock } from "./repProfile";
import {
  createBrief,
  failBrief,
  finishBrief,
  getAccountInteractionCount,
} from "./store";
import type { BriefContext, BriefGenerator } from "./types";

export type GenerateOutcome =
  | { status: "completed"; briefId: string; interactionNumber: number; mode: ObjectiveMode }
  | { status: "not-found" }
  | { status: "failed"; briefId: string; error: string };

export interface GenerateInput {
  userId: string;
  accountId: string;
  narration: string;
  /** The rep's stated objective (required by the route on interactions 1–2). */
  repObjective: string | null;
}

export interface GenerateDeps {
  generator?: BriefGenerator;
  /** Override the interaction count (tests). Defaults to the DB count. */
  interactionCount?: number;
  nowMs?: number;
}

/**
 * Generate and persist a pre-call brief for a rep-owned account. Returns
 * 'not-found' if the rep isn't assigned to the account (the access boundary lives
 * in getAccountForUser). On a model/parse failure the row is marked failed and the
 * error is returned (the route maps it to a 502); the row persists for history.
 */
export async function generateBriefForAccount(
  input: GenerateInput,
  deps: GenerateDeps = {},
): Promise<GenerateOutcome> {
  const account = await getAccountForUser(input.userId, input.accountId);
  if (!account) return { status: "not-found" };

  const priorInteractions =
    deps.interactionCount ?? (await getAccountInteractionCount(input.accountId));
  const interactionNumber = nextInteractionNumber(priorInteractions);
  const mode = resolveObjectiveMode(interactionNumber);

  const repProfile = await buildRepProfileBlock(input.userId);

  const context: BriefContext = {
    accountName: account.name,
    accountStage: account.stage,
    accountSummary: account.summary,
    narration: input.narration,
    interactionNumber,
    objectiveMode: mode,
    repObjective: mode === "rep" ? input.repObjective : null,
    repProfile,
  };

  const briefId = await createBrief(
    {
      accountId: input.accountId,
      userId: input.userId,
      interactionNumber,
      narration: input.narration,
      objectiveMode: mode,
      repObjective: input.repObjective,
    },
    deps.nowMs,
  );

  const generator =
    deps.generator ??
    new AnthropicBriefGenerator({
      onUsage: (usage: CacheUsageSummary) => {
        // Phase 17 telemetry: log the methodology+rep-profile cache hit rate
        // (counts only, no PII). Visible in the Vercel runtime logs.
        console.log(`[precall] brief ${briefId} ${formatCacheUsage(usage)}`);
      },
    });

  try {
    const result = await generator.generate(context);
    // Enforce the HARD RULE: a signal-mode brief (interaction 3+) MUST carry a
    // recommended objective. If the model returned none, that's a generation
    // failure — never persist a "completed" signal brief with no objective (it
    // would silently degrade to a ruleless, objective-less prep).
    if (mode === "signal" && !(result.recommendedObjective ?? "").trim()) {
      const error = "Signal-mode brief returned no recommended objective.";
      await failBrief(briefId, error);
      return { status: "failed", briefId, error };
    }
    await finishBrief(briefId, mode, result);
    return { status: "completed", briefId, interactionNumber, mode };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await failBrief(briefId, error);
    return { status: "failed", briefId, error };
  }
}
