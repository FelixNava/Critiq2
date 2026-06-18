/**
 * The locked conservative policy (Phase 26). Pure decision functions — no I/O — so the
 * "what do we do with an ungrounded personal reference" rule is one testable place.
 *
 * Locked default: CONSERVATIVE (be paranoid). An ungrounded personal reference is redacted
 * out of the output rather than shown to the rep. `balanced` and `off` exist for tuning and
 * as a kill-switch (see resolveGuardMode), but the default the app ships with is conservative.
 */

import type { GuardAction, GuardMode } from "./types";

/** The locked beta default. */
export const DEFAULT_GUARD_MODE: GuardMode = "conservative";

/** What an ungrounded span is replaced with when redacted. Neutral, no dev jargon. */
export const DEFAULT_REDACTION_PLACEHOLDER = "[unverified]";

const GUARD_MODES = new Set<GuardMode>(["conservative", "balanced", "off"]);

/**
 * Resolve the active guard mode. Defaults to CONSERVATIVE; an operator can override via
 * `CRITIQ_HALLUCINATION_GUARD_MODE` (a runtime kill-switch / tuning dial that needs no
 * code deploy) — but ONLY to a known mode; anything else falls back to conservative. The
 * guard is never silently disabled by a typo.
 */
export function resolveGuardMode(
  raw: string | undefined = process.env.CRITIQ_HALLUCINATION_GUARD_MODE,
): GuardMode {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return GUARD_MODES.has(v as GuardMode) ? (v as GuardMode) : DEFAULT_GUARD_MODE;
}

/**
 * The core decision: given the mode and whether a reference was grounded, what happens to it.
 *   - grounded references are always KEPT (the corpus supports them).
 *   - off: never touch anything (observe-only).
 *   - balanced: an ungrounded reference is FLAGGED (recorded, left in text).
 *   - conservative: an ungrounded reference is REDACTED.
 */
export function resolveAction(mode: GuardMode, grounded: boolean): GuardAction {
  if (grounded) return "kept";
  if (mode === "off") return "kept";
  if (mode === "balanced") return "flagged";
  return "redacted"; // conservative
}
