/**
 * Objective handoff rule (Phase 18). The locked product mechanic: who sets a
 * call's objective is a HARD RULE keyed off the account's interaction count —
 * NOT a vague AI judgment (Signal PRD §07, "It must be implemented as a rule").
 *
 *   - Interactions 1 and 2  → the REP sets the objective. Critiq only confirms it
 *     and (Phase 19) builds the script around it.
 *   - Interaction 3 onward  → Critiq RECOMMENDS the objective (leads with a next
 *     step). The rep can override at any interaction; the override is recorded.
 *
 * Pure + unit-tested so the threshold can't silently drift.
 */

/** Critiq begins recommending the objective on this interaction number. */
export const OBJECTIVE_HANDOFF_THRESHOLD = 3;

/* Pre-call input guards (shared by the routes). The narration is free-form prep
 * notes; the objective is a single next-step sentence. */
export const MAX_NARRATION = 4000;
export const MAX_OBJECTIVE = 500;

export type ObjectiveMode = "rep" | "signal";

/**
 * Resolve who sets the objective for a given 1-based interaction number.
 * Non-finite / <1 inputs fail safe to interaction 1 (rep-set) — a bad count must
 * never accidentally hand objective-setting to the model on a cold account.
 */
export function resolveObjectiveMode(interactionNumber: number): ObjectiveMode {
  const n =
    Number.isFinite(interactionNumber) && interactionNumber >= 1
      ? Math.floor(interactionNumber)
      : 1;
  return n >= OBJECTIVE_HANDOFF_THRESHOLD ? "signal" : "rep";
}

/** Convenience: does Critiq recommend the objective for this interaction? */
export function signalLeadsObjective(interactionNumber: number): boolean {
  return resolveObjectiveMode(interactionNumber) === "signal";
}

/**
 * The 1-based interaction number for the NEXT prep, given how many interactions
 * an account already has. Clamps a bad prior count to 0 → next interaction 1.
 */
export function nextInteractionNumber(priorInteractions: number): number {
  const prior =
    Number.isFinite(priorInteractions) && priorInteractions > 0
      ? Math.floor(priorInteractions)
      : 0;
  return prior + 1;
}
