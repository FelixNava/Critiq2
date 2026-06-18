/**
 * Build the GROUNDED CORPUS for a (rep, account) pair (Phase 26) — the only impure part of
 * the guard. It assembles the source-tagged material Critiq is actually allowed to assert,
 * from the existing tiers, each carrying its ORIGINATING interaction id (the locked
 * requirement: a personal detail may only be surfaced if it's source-tagged to an interaction):
 *
 *   - Phase 23 account facts  (account_summaries.facts → id = sourceDebriefId)
 *   - Phase 23 account narrative/headline (the shared running summary → id "account-summary")
 *   - Phase 24 rep traits     (rep_summaries.traits → id = sourceDebriefId)
 *   - Phase 25 raw interactions (the rep's verbatim debrief reports → id = debriefId)
 *
 * Reuses the Phase 23/24 stores + the Phase 25 raw reader (rep-private scope, DEC-039 — a
 * rep's grounding never includes another rep's raw notes; shared account intel reaches the
 * corpus via the rep-agnostic Phase 23 facts). Reads only; writes nothing; no new schema.
 */

import { getAccountSummary } from "@/lib/consolidation/store";
import { getRepSummary } from "@/lib/repconsolidation/store";
import { getRecentRawInteractionsForAccount } from "@/lib/workingmemory/sources";
import type { DebriefReport } from "@/lib/debrief/types";
import type { GroundedSource } from "./types";

/**
 * How many of the rep's recent reports on this account feed the grounding corpus. Larger than
 * the working-set cap (the corpus is for MATCHING, not the consumer's prompt budget) so a
 * detail mentioned a few calls back still grounds.
 */
export const GROUNDING_MAX_RAW_INTERACTIONS = 10;

/** One attributed item as stored in jsonb: { text, sourceDebriefId }. */
interface AttributedSourced {
  text: string;
  sourceDebriefId: string;
}

/** Coerce a stored facts/traits jsonb value into {text, sourceDebriefId} items (defensive). */
function coerceAttributedSourced(v: unknown): AttributedSourced[] {
  if (!Array.isArray(v)) return [];
  const out: AttributedSourced[] = [];
  for (const item of v) {
    const o = (item ?? {}) as Record<string, unknown>;
    const text = typeof o.text === "string" ? o.text.trim() : "";
    const src = typeof o.sourceDebriefId === "string" ? o.sourceDebriefId.trim() : "";
    if (text && src) out.push({ text, sourceDebriefId: src });
  }
  return out;
}

/** Flatten a raw guided report into one searchable text block (all non-empty fields). */
function reportToText(report: DebriefReport): string {
  const parts: (string | undefined)[] = [
    report.objective,
    report.happened,
    report.reaction,
    report.commitments,
    report.surprises,
  ];
  return parts
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter(Boolean)
    .join(" ");
}

/**
 * Assemble the grounded corpus for a rep working an account. Independent reads run together.
 * Returns an empty array (not null) when the account is cold — the guard then treats every
 * personal reference as ungrounded (the correct paranoid posture for a brand-new account).
 */
export async function buildGroundedSources(
  userId: string,
  accountId: string,
): Promise<GroundedSource[]> {
  const [accountSummary, repSummary, raw] = await Promise.all([
    getAccountSummary(accountId),
    getRepSummary(userId),
    getRecentRawInteractionsForAccount(
      userId,
      accountId,
      GROUNDING_MAX_RAW_INTERACTIONS,
    ),
  ]);

  const sources: GroundedSource[] = [];

  // Phase 23 — shared account facts + the running narrative (only when completed).
  if (accountSummary && accountSummary.status === "completed") {
    for (const f of coerceAttributedSourced(accountSummary.facts)) {
      sources.push({ id: f.sourceDebriefId, kind: "account-fact", text: f.text });
    }
    const narrative = [accountSummary.headline, accountSummary.narrative]
      .map((s) => (typeof s === "string" ? s.trim() : ""))
      .filter(Boolean)
      .join(" ");
    if (narrative) {
      sources.push({ id: "account-summary", kind: "account-summary", text: narrative });
    }
  }

  // Phase 24 — rep traits (rep-private; only when completed).
  if (repSummary && repSummary.status === "completed") {
    for (const t of coerceAttributedSourced(repSummary.traits)) {
      sources.push({ id: t.sourceDebriefId, kind: "rep-trait", text: t.text });
    }
  }

  // Phase 25 — the rep's verbatim reports on this account (the richest grounding).
  for (const interaction of raw.interactions) {
    const text = reportToText(interaction.report);
    if (text) {
      sources.push({ id: interaction.debriefId, kind: "raw-interaction", text });
    }
  }

  return sources;
}
