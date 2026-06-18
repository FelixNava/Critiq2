/**
 * The pure working-memory assembler (Phase 25). Takes the raw materials (methodology, rep
 * profile, account summary, recent raw interactions) and assembles them into a working set
 * under a token budget, returning the cache-split layers + a transparent manifest. No DB,
 * no network — unit-tested directly. The DB reads live in build.ts.
 *
 * THE BUDGET POLICY (deterministic, most-important-kept-first):
 *   1. methodology  — ALWAYS kept. The foundation + the cached-forever layer.
 *   2. rep profile  — ALWAYS kept. Small, per-rep, cached.
 *   3. account summary — kept; truncated only if the volatile budget can't hold it.
 *   4. raw interactions — most volatile; fill the remaining budget newest-first. The
 *      newest may be truncated to fit a partial remainder; older ones that don't fit are
 *      dropped (and counted, never silently).
 *
 * Rationale: the stable layers (1–2) are byte-stable and cached, so keeping them is cheap
 * on a cache hit and they're the foundation regardless. The account summary (3) is the
 * distilled shared intelligence — more durable value per token than any single raw report
 * — so it outranks the raw tail (4). "Newest matters most" inside the raw tail.
 */

import {
  DEFAULT_MAX_RAW_INTERACTIONS,
  DEFAULT_WORKING_MEMORY_BUDGET,
  MIN_USEFUL_TOKENS,
  estimateTokens,
  truncateToTokens,
} from "./budget";
import { formatRawInteraction } from "./format";
import type {
  WorkingMemory,
  WorkingMemoryLayerInfo,
  WorkingMemoryManifest,
  WorkingMemoryOptions,
  WorkingMemorySources,
} from "./types";

/** Separator between the account summary and the raw-interactions sections of the volatile block. */
const SECTION_SEP = "\n\n";
/** Header introducing the recent-interactions section (costed against the budget). */
const RAW_SECTION_HEADER = "RECENT INTERACTIONS WITH THIS ACCOUNT (most recent first):";

export function assembleWorkingMemory(
  sources: WorkingMemorySources,
  options: WorkingMemoryOptions = {},
): WorkingMemory {
  const budget = options.tokenBudget ?? DEFAULT_WORKING_MEMORY_BUDGET;

  // ---- Stable layers (always kept): methodology + rep profile. ----
  const methodologyTokens = estimateTokens(sources.methodology);
  const repProfileText = sources.repProfile?.trim() ? sources.repProfile : null;
  const repProfileTokens = repProfileText ? estimateTokens(repProfileText) : 0;

  const stableLayers: WorkingMemory["stableLayers"] = [
    { text: sources.methodology },
  ];
  if (repProfileText) stableLayers.push({ text: repProfileText });

  const reservedTokens = methodologyTokens + repProfileTokens;
  // The foundation is never trimmed even if it alone exceeds the budget (a degenerate
  // case); volatileBudget just floors at 0 and withinBudget reports the overflow.
  let remaining = Math.max(0, budget - reservedTokens);

  const volatileParts: string[] = [];

  // ---- (3) Account summary (truncate if needed). ----
  let accountIncluded = false;
  let accountTruncated = false;
  let accountTokens = 0;
  const accountText = sources.accountSummary?.trim() ? sources.accountSummary : null;
  if (accountText) {
    const full = estimateTokens(accountText);
    if (full <= remaining) {
      volatileParts.push(accountText);
      accountIncluded = true;
      accountTokens = full;
      remaining -= full;
    } else if (remaining >= MIN_USEFUL_TOKENS) {
      const trimmed = truncateToTokens(accountText, remaining);
      if (trimmed) {
        volatileParts.push(trimmed);
        accountIncluded = true;
        accountTruncated = true;
        accountTokens = estimateTokens(trimmed);
        remaining -= accountTokens;
      }
    }
    // else: no room — account summary dropped (rare; only under severe pressure).
  }

  // ---- (4) Raw interactions, newest first. ----
  // Honor the per-call cap HERE too (not only at the DB layer), so a direct assembler
  // caller's maxRawInteractions is respected; the overflow is disclosed, not silent.
  const maxRaw = options.maxRawInteractions ?? DEFAULT_MAX_RAW_INTERACTIONS;
  const rawCandidates = sources.rawInteractions.slice(0, Math.max(0, maxRaw));
  const cappedByMax = sources.rawInteractions.length - rawCandidates.length;

  // Reserve the section header so the raw budget includes the text actually emitted around
  // the blocks (block separators are whitespace → ~0 tokens by the heuristic). Only spend
  // it when there's at least one candidate (no candidates ⇒ no header emitted).
  const rawHeaderCost = estimateTokens(RAW_SECTION_HEADER);
  let rawRemaining =
    rawCandidates.length > 0 ? Math.max(0, remaining - rawHeaderCost) : remaining;

  let rawIncluded = 0;
  let rawTruncated = 0;
  let rawDroppedForBudget = 0;
  const renderedRaw: string[] = [];

  for (let i = 0; i < rawCandidates.length; i++) {
    const block = formatRawInteraction(rawCandidates[i], i + 1);
    const cost = estimateTokens(block);
    if (cost <= rawRemaining) {
      renderedRaw.push(block);
      rawIncluded += 1;
      rawRemaining -= cost;
    } else if (rawRemaining >= MIN_USEFUL_TOKENS) {
      // Partial room for the newest that didn't fit — truncate it, then stop.
      const trimmed = truncateToTokens(block, rawRemaining);
      if (trimmed) {
        renderedRaw.push(trimmed);
        rawIncluded += 1;
        rawTruncated += 1;
        rawRemaining = 0;
        rawDroppedForBudget += rawCandidates.length - (i + 1); // the older ones
      } else {
        // truncate yielded nothing usable — this one is dropped too (exact accounting).
        rawDroppedForBudget += rawCandidates.length - i;
      }
      break;
    } else {
      // No useful room left — drop this and all remaining.
      rawDroppedForBudget += rawCandidates.length - i;
      break;
    }
  }

  let rawSection = "";
  if (renderedRaw.length > 0) {
    rawSection = [RAW_SECTION_HEADER, ...renderedRaw].join("\n\n");
    volatileParts.push(rawSection);
  }

  const volatileContext = volatileParts.join(SECTION_SEP);

  // Exact token accounting from the ACTUAL emitted text (section header + separators
  // included), so the estimate never UNDER-counts (budget.ts contract) and withinBudget is
  // trustworthy. The per-layer figures below are component estimates for the breakdown.
  const rawTokens = estimateTokens(rawSection);
  const stableTokens = stableLayers.reduce((n, l) => n + estimateTokens(l.text), 0);
  const estimatedTokens = stableTokens + estimateTokens(volatileContext);

  // Dropped = capped-by-max + older-than-cap (never fetched) + dropped-for-budget.
  const rawInteractionsDropped =
    sources.olderInteractionsOmitted + cappedByMax + rawDroppedForBudget;

  const layers: WorkingMemoryLayerInfo[] = [
    {
      name: "methodology",
      estimatedTokens: methodologyTokens,
      included: true,
      truncated: false,
    },
    {
      name: "repProfile",
      estimatedTokens: repProfileTokens,
      included: repProfileText != null,
      truncated: false,
    },
    {
      name: "accountSummary",
      estimatedTokens: accountTokens,
      included: accountIncluded,
      truncated: accountTruncated,
    },
    {
      name: "rawInteractions",
      estimatedTokens: rawTokens,
      included: rawIncluded > 0,
      truncated: rawTruncated > 0,
    },
  ];

  const manifest: WorkingMemoryManifest = {
    repProfileSource: sources.repProfileSource,
    rawInteractionsIncluded: rawIncluded,
    rawInteractionsDropped,
    rawInteractionsTruncated: rawTruncated,
    accountSummaryIncluded: accountIncluded,
    accountSummaryTruncated: accountTruncated,
    estimatedTokens,
    tokenBudget: budget,
    withinBudget: estimatedTokens <= budget,
    layers,
  };

  return { stableLayers, volatileContext, manifest };
}
