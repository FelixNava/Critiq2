/**
 * Import a past call (Phase 35b). Reps arrive with calls that happened before Critiq —
 * notes or a pasted transcript. Rather than build a new ingestion pipeline, an import
 * becomes a synthetic Phase 20 debrief: the pasted text is the rep's account of "what
 * happened", structured by the SAME debrief generator. Once it's a completed debrief it
 * AUTOMATICALLY feeds everything downstream — Phase 23/24 consolidation, Phase 25 working
 * memory, the Phase 26 grounding corpus — with no special-casing.
 *
 * The only difference from a live debrief is the input size: a transcript is far longer
 * than a few guided sentences, so the imported `happened` gets a much larger cap than the
 * Reporter-Mode MAX_HAPPENED. This module is the pure normalizer; the route runs the
 * generator + fires consolidation.
 */

import { MAX_FIELD } from "./reporter";
import type { DebriefReport } from "./types";

/**
 * Max characters of pasted transcript/notes accepted in one import (~12k tokens — a
 * generous full-call transcript). Beyond this the rep should trim; we clamp rather than
 * reject so a slightly-over paste still works. Larger than the live-debrief cap because
 * a transcript is verbatim, not a summary.
 */
export const IMPORT_MAX_CHARS = 50000;

/** The smallest paste worth structuring — guards against an accidental empty/one-word import. */
export const IMPORT_MIN_CHARS = 20;

export interface ImportInput {
  /** The pasted transcript or notes (required). */
  rawText: unknown;
  /** Optional one-line "what was this call about" the rep can add for context. */
  about?: unknown;
}

export type ImportValidation =
  | { ok: true; report: DebriefReport }
  | { ok: false; error: string };

/**
 * Build a DebriefReport from an import. The pasted text becomes `happened` (the episodic
 * source of truth); the optional "about" line becomes `objective`. Trims + clamps; rejects
 * an empty/too-short paste. Pure — unit-tested without a DB or network.
 */
export function normalizeImport(input: ImportInput): ImportValidation {
  const rawText =
    typeof input.rawText === "string" ? input.rawText.trim() : "";
  if (rawText.length < IMPORT_MIN_CHARS) {
    return {
      ok: false,
      error: "Paste the call notes or transcript you want to import first.",
    };
  }
  const happened = rawText.slice(0, IMPORT_MAX_CHARS);

  const about = typeof input.about === "string" ? input.about.trim() : "";
  const report: DebriefReport = { happened };
  if (about) report.objective = about.slice(0, MAX_FIELD);

  return { ok: true, report };
}
