/**
 * Phase 35c — the working-memory → AI-consumer adapter.
 *
 * Phase 25 built buildWorkingMemory as a primitive consumed by nothing. This is the seam that
 * plugs it into the four live AI consumers (pre-call brief 18, script 19, debrief 20, coaching
 * 21). Each consumer already carries its OWN task-specific system prompt + the shared account
 * summary; this adapter gives them the two things working memory adds:
 *
 *   1. the RICHER rep profile — the LEARNED Phase 24 summary once the rep has crossed the first
 *      consolidation interval, else the static Phase 18 intake profile, else none (the exact
 *      cold-start fallback resolveRepProfile already encodes). At cold start this is identical to
 *      the buildRepProfileBlock the consumers used before — a strict, low-regression enrichment.
 *   2. a volatile MEMORY CONTEXT block — the rep + account free-text context (Phase 35a) + the
 *      account semantic summary (Phase 23, falling back to account_records.summary) + the rep's
 *      last-N raw interactions on this account (Phase 25), assembled under a token budget.
 *
 * CACHE SPLIT (locked memory architecture) is preserved: the rep profile is returned for the
 * consumer to pass to buildCachedSystem as its per-rep cached layer 2 (exactly as before); the
 * memory context is VOLATILE and goes in the per-call user message — never cached.
 *
 * GROUNDING (Phase 26): every reference the memory context can introduce — rep/account context,
 * account facts, raw interactions — is already in the coaching guard's grounded corpus
 * (buildGroundedSources), so injecting it never causes a false redaction. Only coaching runs the
 * guard; the other three consumers have no guard wired in (unchanged here).
 *
 * ACCESS BOUNDARY: the CALLER must have already authorized the rep for this (userId, accountId)
 * pair — every consumer's generate() calls getAccountForUser first and returns 'not-found' when
 * the rep isn't assigned, and it holds the resulting account. So this adapter takes the account's
 * name + summary as input rather than re-fetching the row (and its contacts) a second time. The
 * underlying readers are themselves rep-scoped (raw interactions) or shared-account reads on an
 * already-authorized account. When the account is cold (no summary, no interactions, no context)
 * memoryContext is "" and renderAccountKnowledge reproduces the consumer's pre-35c prompt
 * byte-for-byte. Reads only; writes nothing; no schema change.
 */

import { getAccountContext, getRepContext } from "@/lib/context";
import { assembleWorkingMemory } from "./assemble";
import { DEFAULT_MAX_RAW_INTERACTIONS } from "./budget";
import { accountSummaryHeader } from "./format";
import {
  getRecentRawInteractionsForAccount,
  resolveAccountSummary,
  resolveRepProfile,
} from "./sources";
import type { RepProfileSource, WorkingMemoryManifest } from "./types";

/**
 * Budget for the volatile memory block a consumer prompt receives (account summary + recent raw
 * interactions). The consumer supplies its own task system prompt + the cached rep profile
 * separately, so this protects only the volatile tail. Free-text context (Phase 35a) is added on
 * top, un-budgeted — it's small, rep-entered ground truth that should essentially always be
 * carried; if a rep types a pathological wall of text the consumer's model context still bounds it.
 */
export const CONSUMER_MEMORY_BUDGET = 5000;

/** The already-authorized account the caller holds (from its own getAccountForUser gate). */
export interface ConsumerAccount {
  name: string;
  /** account_records.summary — the shared running narrative, or null at cold start. */
  summary: string | null;
}

/** What a consumer needs to wire working memory into its prompt. */
export interface ConsumerWorkingMemory {
  /** The rep-profile layer (learned/intake/none) for the consumer's cached layer 2. */
  repProfile: string | null;
  repProfileSource: RepProfileSource;
  /** The volatile context block for the user message (empty string at full cold start). */
  memoryContext: string;
  /** The assembler manifest for the volatile tail (counts only — log it, no PII). */
  manifest: WorkingMemoryManifest;
}

/** Label the rep + account free-text context so the model knows the scope of each block. */
function renderContextBlocks(
  repCtx: string | null,
  accountCtx: string | null,
): string {
  const parts: string[] = [];
  const account = accountCtx?.trim();
  if (account) {
    parts.push(
      [
        "WHAT THE TEAM TOLD CRITIQ ABOUT THIS ACCOUNT (entered directly — treat as ground truth about this account):",
        account,
      ].join("\n"),
    );
  }
  const rep = repCtx?.trim();
  if (rep) {
    parts.push(
      [
        "WHAT THIS REP TOLD CRITIQ ABOUT HOW THEY SELL (rep-level — applies across all their accounts, not specific to this one):",
        rep,
      ].join("\n"),
    );
  }
  return parts.join("\n\n");
}

/**
 * Build the working-memory pieces a consumer injects, for a rep working an account the caller has
 * ALREADY authorized (see the access-boundary note above). Independent reads run together.
 */
export async function buildConsumerWorkingMemory(
  userId: string,
  accountId: string,
  account: ConsumerAccount,
  options: { maxRawInteractions?: number; tokenBudget?: number } = {},
): Promise<ConsumerWorkingMemory> {
  const maxRaw = options.maxRawInteractions ?? DEFAULT_MAX_RAW_INTERACTIONS;

  const [repProfile, accountSummaryBlock, raw, repCtx, accountCtx] =
    await Promise.all([
      resolveRepProfile(userId),
      resolveAccountSummary(accountId, account.name),
      getRecentRawInteractionsForAccount(userId, accountId, maxRaw),
      getRepContext(userId),
      getAccountContext(accountId),
    ]);

  // Account-summary fallback: if the Phase-23 account_summaries row isn't present yet but the
  // shared account_records.summary narrative is set, carry it so wiring memory in never LOSES the
  // summary the consumer used to show. (resolveAccountSummary reads the richer attributed row;
  // this covers the gap before the first consolidation runs.)
  const accountSummary =
    accountSummaryBlock ??
    (account.summary?.trim()
      ? `${accountSummaryHeader(account.name)}\n\n${account.summary.trim()}`
      : null);

  // Assemble the budgeted volatile tail (account summary + raw interactions). methodology + rep
  // profile are the CONSUMER's responsibility (its own task prompt + the cached layer), so they're
  // passed empty here and the full budget protects the volatile tail.
  const assembled = assembleWorkingMemory(
    {
      methodology: "",
      repProfile: null,
      repProfileSource: "none",
      accountSummary,
      rawInteractions: raw.interactions,
      olderInteractionsOmitted: Math.max(
        0,
        raw.totalCompleted - raw.interactions.length,
      ),
    },
    {
      tokenBudget: options.tokenBudget ?? CONSUMER_MEMORY_BUDGET,
      maxRawInteractions: maxRaw,
    },
  );

  // Free-text context (Phase 35a) — rep-entered ground truth, grounded (never redacted by the
  // Phase 26 guard). Added on top of the budgeted tail, account block first.
  const contextBlock = renderContextBlocks(repCtx, accountCtx);

  const memoryContext = [contextBlock, assembled.volatileContext]
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n\n");

  return {
    repProfile: repProfile.text,
    repProfileSource: repProfile.source,
    memoryContext,
    manifest: assembled.manifest,
  };
}
