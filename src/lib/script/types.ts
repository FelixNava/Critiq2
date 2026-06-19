/**
 * Call-script types (Phase 19). The script is the prep step's second AI output
 * (Signal PRD Step 04): a delivery-cued conversation framework built FROM a
 * completed Phase 18 brief (its diagnosis + approach + the in-force objective),
 * tailored to a style mode. The email draft the PRD mentions alongside the script
 * is Phase 22 (email drafting) — deliberately OUT of this phase.
 */

import type { StyleMode } from "./style";

/** The kinds of inline delivery coaching attached to a script line (PRD §04). */
export type CueKind = "emphasis" | "pace" | "pause" | "register" | "silence";

/** All recognized cue kinds (for coercion + the prompt contract). */
export const CUE_KINDS: readonly CueKind[] = [
  "emphasis",
  "pace",
  "pause",
  "register",
  "silence",
];

/** One inline delivery cue: how to say a line, not what to say. */
export interface DeliveryCue {
  kind: CueKind;
  note: string;
}

/** One suggested thing to say or ask, plus its inline delivery cues. */
export interface ScriptLine {
  say: string;
  cues: DeliveryCue[];
}

/** A section of the conversation framework (loosely mapped to the SPIN flow). */
export interface ScriptSection {
  label: string;
  /** What this section is meant to accomplish. */
  purpose: string;
  lines: ScriptLine[];
}

/** The structured script the model returns (already parsed + normalized). */
export interface ScriptResult {
  /** The style mode the script was written in (echoed back for the record). */
  styleMode: StyleMode;
  /** How to open the call. */
  opener: string;
  /** The conversation framework. */
  sections: ScriptSection[];
  /** How to drive toward the objective + secure the next step. */
  closing: string;
  /** Call-level delivery coaching (overall pacing/silence/register guidance). */
  deliveryNotes: string[];
}

/** The context assembled for a single script generation. */
export interface ScriptContext {
  accountName: string;
  accountStage: string;
  /** Shared running account intelligence; null/empty at cold start. */
  accountSummary: string | null;
  /** The in-force objective for the call (snapshot from the brief). */
  objective: string;
  /** The brief's plain-language account diagnosis. */
  diagnosis: string | null;
  /** The brief's strategic approach points. */
  approach: { focus: string; why: string }[];
  /** The brief's anticipated objections. */
  objections: { objection: string; response: string }[];
  /** The chosen style mode. */
  styleMode: StyleMode;
  /** A stable, formatted rep-profile block (learned/intake), or null if none. */
  repProfile: string | null;
  /**
   * Phase 35c — the assembled working-memory context (rep + account free-text context + the
   * account semantic summary + recent raw interactions). Supersedes the bare `accountSummary`
   * in the account-knowledge section when present; null/absent keeps the pre-35c prompt.
   * Volatile → never cached.
   */
  memoryContext?: string | null;
}

/** A generator that turns a ScriptContext into a ScriptResult (DI seam for tests). */
export interface ScriptGenerator {
  generate(context: ScriptContext): Promise<ScriptResult>;
}
