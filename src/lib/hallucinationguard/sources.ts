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
import { getRepContext, getAccountContext } from "@/lib/context";
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

/** The account's own ground-truth identity (the rep named the account; it's safe to assert). */
export interface AccountIdentity {
  name?: string | null;
  /** account_records.summary — the shared running narrative the model is given. */
  summary?: string | null;
}

/**
 * Assemble the grounded corpus for a rep working an account. Independent reads run together.
 * Returns the account's own identity (always allowed) + whatever semantic/episodic grounding
 * exists; a brand-new account with no history yields just the identity (so every other
 * personal reference is treated as ungrounded — the correct paranoid posture).
 */
export async function buildGroundedSources(
  userId: string,
  accountId: string,
  identity: AccountIdentity = {},
): Promise<GroundedSource[]> {
  const [accountSummary, repSummary, raw, repCtx, accountCtx] = await Promise.all([
    getAccountSummary(accountId),
    getRepSummary(userId),
    getRecentRawInteractionsForAccount(
      userId,
      accountId,
      GROUNDING_MAX_RAW_INTERACTIONS,
    ),
    getRepContext(userId),
    getAccountContext(accountId),
  ]);

  const sources: GroundedSource[] = [];

  // Phase 35a — human-entered context the rep explicitly told Critiq. These carry a
  // stable SYNTHETIC source id (the locked decision: context is grounded, never
  // redactable) so a true detail the rep added surfaces in coaching unredacted. The
  // rep context is rep-private; the account context is the shared account note.
  if (repCtx) {
    sources.push({ id: "rep-context", kind: "rep-context", text: repCtx });
  }
  if (accountCtx) {
    sources.push({
      id: "account-context",
      kind: "account-context",
      text: accountCtx,
    });
  }

  // The account's own NAME is ground truth — the rep created/named the account, and the
  // generator is given the name, so it must be groundable (else legitimately naming the
  // account would be redacted whenever the Phase 23 summary isn't yet present).
  const name = typeof identity.name === "string" ? identity.name.trim() : "";
  if (name) sources.push({ id: "account-name", kind: "account-summary", text: name });

  // The shared running narrative written back to account_records.summary (Phase 23), when set.
  const recordSummary = typeof identity.summary === "string" ? identity.summary.trim() : "";
  if (recordSummary) {
    sources.push({ id: "account-summary", kind: "account-summary", text: recordSummary });
  }

  // Phase 23 — shared account facts + the running narrative. The stored facts are always the
  // LAST GOOD consolidation (one row/account, rewritten only on finish), so they ground even
  // while a regeneration is mid-flight — gate on having content, not on the transient status.
  if (accountSummary) {
    for (const f of coerceAttributedSourced(accountSummary.facts)) {
      sources.push({ id: f.sourceDebriefId, kind: "account-fact", text: f.text });
    }
    const narrative = [accountSummary.headline, accountSummary.narrative]
      .map((s) => (typeof s === "string" ? s.trim() : ""))
      .filter(Boolean)
      .join(" ");
    if (narrative && narrative !== recordSummary) {
      sources.push({ id: "account-summary", kind: "account-summary", text: narrative });
    }
  }

  // Phase 24 — rep traits (rep-private). Same: the stored traits are the last good profile.
  if (repSummary) {
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
