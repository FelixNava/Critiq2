/**
 * Reporter Mode guided prompts (Phase 20). The debrief is captured through a small
 * set of OBSERVATIONAL questions — "report what happened," not "grade yourself."
 * The prompts are the single source of truth for the UI fields, the input guards,
 * and the narration assembled for the model, so the three never drift.
 *
 * Pure (no DB, no network) so the field set + the assembled narration are
 * unit-tested. Text-only for beta; voice answers are a later phase.
 */

import type { DebriefReport } from "./types";

/** Per-field length guard. The "what happened" narrative gets the most room. */
export const MAX_HAPPENED = 4000;
export const MAX_FIELD = 2000;

/** The keys of a DebriefReport, in display + narration order. */
export type ReportField = keyof DebriefReport;

export interface ReporterPrompt {
  key: ReportField;
  /** The question shown to the rep. */
  label: string;
  /** Short helper text under the question (observational framing, no dev jargon). */
  helper: string;
  /** Example answer (placeholder). */
  placeholder: string;
  /** Whether the rep must answer (only the core narrative is required). */
  required: boolean;
  /** Max characters for this field. */
  max: number;
}

/**
 * The guided observational prompts, in order. Only `happened` is required — a rep in
 * a hurry can log the gist of the call and still get a useful structured record; the
 * optional fields sharpen it.
 */
export const REPORTER_PROMPTS: readonly ReporterPrompt[] = [
  {
    key: "objective",
    label: "What were you trying to do on this call?",
    helper: "Just the goal you went in with. Skip it if it was an unplanned chat.",
    placeholder: "e.g. Lock in a walkthrough date for the warehouse repaint.",
    required: false,
    max: MAX_FIELD,
  },
  {
    key: "happened",
    label: "What actually happened? Walk me through it.",
    helper:
      "Report it like you'd tell a teammate — what was said and done, start to finish. Don't grade yourself; just what happened.",
    placeholder:
      "e.g. Got Dana on the phone. Opened with the durability angle, she warmed up, then raised the price again. I asked how the budget was set this year and she opened up about a cap from her GM…",
    required: true,
    max: MAX_HAPPENED,
  },
  {
    key: "reaction",
    label: "How did they react?",
    helper: "Mood, energy, where they leaned in, where they pushed back.",
    placeholder:
      "e.g. Friendly but guarded on price. Got noticeably more engaged when I mentioned the lifetime-cost breakdown.",
    required: false,
    max: MAX_FIELD,
  },
  {
    key: "commitments",
    label: "What got decided or committed to?",
    helper: "Anything either of you agreed to, and the next step.",
    placeholder:
      "e.g. She'll check the budget cap with her GM. I'll send the lifetime-cost sheet by Friday and follow up Monday.",
    required: false,
    max: MAX_FIELD,
  },
  {
    key: "surprises",
    label: "Anything surprise you, or that you're unsure about?",
    helper: "Loose ends, gut feelings, things you want to figure out before next time.",
    placeholder:
      "e.g. Didn't expect the GM to be the real decision-maker. Not sure if the price objection is real or a stall.",
    required: false,
    max: MAX_FIELD,
  },
] as const;

/**
 * Coerce arbitrary input into a clean DebriefReport: trim every field, clamp to its
 * length guard, drop empty optional fields. `happened` is always present (possibly
 * empty — the route/generate path enforces non-empty separately). Pure.
 */
export function normalizeReport(raw: unknown): DebriefReport {
  const o = (raw ?? {}) as Record<string, unknown>;
  const take = (key: ReportField, max: number): string => {
    const v = o[key];
    return typeof v === "string" ? v.trim().slice(0, max) : "";
  };
  const report: DebriefReport = {
    happened: take("happened", MAX_HAPPENED),
  };
  for (const p of REPORTER_PROMPTS) {
    if (p.key === "happened") continue;
    const value = take(p.key, p.max);
    if (value) report[p.key] = value;
  }
  return report;
}

/** Is there a usable core narrative? (The one hard requirement.) */
export function hasNarrative(report: DebriefReport): boolean {
  return report.happened.trim().length > 0;
}

/**
 * Assemble the rep's guided answers into the labeled narration block the model
 * reads. Deterministic field order; omits empty optional fields. Pure + exported so
 * the exact text is unit-tested without a network call.
 */
export function assembleReportNarration(report: DebriefReport): string {
  const lines: string[] = [];
  const labelFor: Record<ReportField, string> = {
    objective: "WHAT THE REP SET OUT TO DO",
    happened: "WHAT HAPPENED (the rep's account)",
    reaction: "HOW THE OTHER SIDE REACTED",
    commitments: "WHAT WAS DECIDED / COMMITTED",
    surprises: "WHAT SURPRISED THE REP / OPEN QUESTIONS",
  };
  for (const p of REPORTER_PROMPTS) {
    const value = (report[p.key] ?? "").trim();
    if (!value) continue;
    lines.push(`${labelFor[p.key]}:`, value, "");
  }
  return lines.join("\n").trim();
}
