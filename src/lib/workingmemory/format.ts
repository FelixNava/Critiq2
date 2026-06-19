/**
 * Formatters that turn the stored semantic + episodic rows into the stable, readable text
 * blocks the working set is assembled from (Phase 25). Pure + deterministic so the same
 * inputs always produce byte-identical blocks (the rep + methodology layers must be stable
 * to cache). jsonb fields are coerced defensively — the same posture the consolidation
 * readers take, because a stored facts/traits array is `unknown` at the type level.
 */

import type { AccountSummary, RepSummary } from "@/db/schema";
import type { DebriefReport } from "@/lib/debrief/types";
import type { RawInteraction } from "./types";

/** Human labels for the raw guided-report fields (mirrors the debrief reporter's labels). */
const REPORT_FIELD_LABELS: { key: keyof DebriefReport; label: string }[] = [
  { key: "objective", label: "Objective" },
  { key: "happened", label: "What happened" },
  { key: "reaction", label: "How they reacted" },
  { key: "commitments", label: "Commitments / next steps" },
  { key: "surprises", label: "Surprises / open questions" },
];

/** One attributed fact/trait as stored in jsonb: { text, lens, sourceDebriefId }. */
interface AttributedItem {
  text: string;
  lens: string;
}

/** Coerce a stored facts/traits jsonb value into readable {text, lens} items. */
function coerceAttributed(v: unknown): AttributedItem[] {
  if (!Array.isArray(v)) return [];
  const out: AttributedItem[] = [];
  for (const item of v) {
    const o = (item ?? {}) as Record<string, unknown>;
    const text = typeof o.text === "string" ? o.text.trim() : "";
    if (!text) continue;
    const lens = typeof o.lens === "string" && o.lens.trim() ? o.lens.trim() : "general";
    out.push({ text, lens });
  }
  return out;
}

/**
 * Format the LEARNED rep profile (rep_summaries, Phase 24) into the rep-profile block.
 * Returns null when the row has no usable narrative/traits (so the caller can fall back to
 * the static intake profile). Rep identity is allowed here — the profile is about the rep.
 */
export function formatRepProfileFromSummary(summary: RepSummary): string | null {
  const headline = summary.headline?.trim() ?? "";
  const narrative = summary.narrative?.trim() ?? "";
  const traits = coerceAttributed(summary.traits);
  if (!narrative && !headline && traits.length === 0) return null;

  const lines: string[] = [
    "THE REP YOU ARE COACHING (a learned profile of how this rep sells — adapt to it):",
  ];
  if (headline) lines.push("", headline);
  if (narrative) lines.push("", narrative);
  if (traits.length > 0) {
    lines.push("", "Observed patterns:");
    for (const t of traits) lines.push(`  - ${t.text} (${t.lens})`);
  }
  return lines.join("\n");
}

/**
 * The header that introduces the account semantic-summary block. Shared so the Phase-23
 * formatted block (formatAccountSummaryBlock) and the pre-consolidation fallback in
 * forConsumer.ts render the SAME header for the same account — no drift between the two paths.
 */
export function accountSummaryHeader(accountName: string): string {
  return `WHAT CRITIQ KNOWS ABOUT THIS ACCOUNT (${accountName}) — shared running intelligence:`;
}

/**
 * Format the account semantic summary (account_summaries, Phase 23) into the account block.
 * Returns null when there's no usable narrative/facts. Rep-agnostic by construction (the
 * stored summary carries no rep identity). The source-debrief ids are intentionally NOT
 * rendered — they're internal provenance for Phase 26's guard, not model-facing text.
 */
export function formatAccountSummaryBlock(
  summary: AccountSummary,
  accountName: string,
): string | null {
  const headline = summary.headline?.trim() ?? "";
  const narrative = summary.narrative?.trim() ?? "";
  const facts = coerceAttributed(summary.facts);
  if (!narrative && !headline && facts.length === 0) return null;

  const lines: string[] = [accountSummaryHeader(accountName)];
  if (headline) lines.push("", headline);
  if (narrative) lines.push("", narrative);
  if (facts.length > 0) {
    lines.push("", "Known facts:");
    for (const f of facts) lines.push(`  - ${f.text} (${f.lens})`);
  }
  return lines.join("\n");
}

/**
 * Format one raw past interaction (the rep's verbatim guided report) into a labeled block.
 * `position` is the 1-based ordinal within the recent set (1 = most recent). Empty optional
 * fields are dropped; `happened` is always present (the debrief required it).
 */
export function formatRawInteraction(
  interaction: RawInteraction,
  position: number,
): string {
  const report = interaction.report;
  const dateLabel = formatDate(interaction.occurredAt);
  const lines: string[] = [`Interaction ${position} (${dateLabel}):`];
  for (const { key, label } of REPORT_FIELD_LABELS) {
    const raw = report[key];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value) lines.push(`  ${label}: ${value}`);
  }
  return lines.join("\n");
}

/** Stable YYYY-MM-DD date label (UTC) — deterministic regardless of server timezone. */
function formatDate(d: Date): string {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "date unknown";
  return d.toISOString().slice(0, 10);
}
