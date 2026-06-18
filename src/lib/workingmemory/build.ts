/**
 * The working-memory builder (Phase 25) — the one entry point AI consumers call. Reads the
 * semantic + episodic tiers for a (rep, account) pair and assembles the bounded working set.
 *
 * Access boundary: a working set is built only if the rep is ASSIGNED to the account
 * (getAccountForUser is the same inner-join boundary the rest of the app uses). A rep can't
 * assemble memory for an account they're not on by guessing its id → returns null.
 *
 * This is the primitive; wiring the existing AI features (pre-call brief, script, debrief,
 * coaching) to consume it is a flagged follow-up (they hand-build their context today). The
 * separation keeps Phase 25 additive and low-risk — same posture as Phase 17's cache helper
 * (built + tested before its first live consumer).
 */

import { getAccountForUser } from "@/lib/accounts";
import { METHODOLOGY_BLOCK } from "./methodology";
import { assembleWorkingMemory } from "./assemble";
import {
  getRecentRawInteractionsForAccount,
  resolveAccountSummary,
  resolveRepProfile,
} from "./sources";
import { DEFAULT_MAX_RAW_INTERACTIONS } from "./budget";
import type {
  WorkingMemory,
  WorkingMemoryOptions,
  WorkingMemorySources,
} from "./types";

/**
 * Build the working set for a rep preparing/working on an account. Returns null when the
 * account doesn't exist, is deleted, or the rep isn't assigned (the access boundary).
 */
export async function buildWorkingMemory(
  userId: string,
  accountId: string,
  options: WorkingMemoryOptions = {},
): Promise<WorkingMemory | null> {
  const account = await getAccountForUser(userId, accountId);
  if (!account) return null;

  const maxRaw = options.maxRawInteractions ?? DEFAULT_MAX_RAW_INTERACTIONS;

  // Reads are independent → run them together.
  const [repProfile, accountSummary, raw] = await Promise.all([
    resolveRepProfile(userId),
    resolveAccountSummary(accountId, account.name),
    getRecentRawInteractionsForAccount(userId, accountId, maxRaw),
  ]);

  const olderInteractionsOmitted = Math.max(
    0,
    raw.totalCompleted - raw.interactions.length,
  );

  const sources: WorkingMemorySources = {
    methodology: METHODOLOGY_BLOCK,
    repProfile: repProfile.text,
    repProfileSource: repProfile.source,
    accountSummary,
    rawInteractions: raw.interactions,
    olderInteractionsOmitted,
  };

  return assembleWorkingMemory(sources, options);
}
