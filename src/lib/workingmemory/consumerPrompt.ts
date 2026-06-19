/**
 * Pure consumer-prompt helpers (Phase 35c). No DB, no network — safe to import from the
 * consumers' pure prompt builders (pre-call / script / debrief / coaching), which the verify
 * scripts exercise without a database.
 *
 * The four AI consumers each render a "WHAT CRITIQ [ALREADY] KNOWS ABOUT THIS ACCOUNT" section
 * whose body was, pre-35c, just the shared account summary or a cold-start note. Phase 35c lets
 * that body be the assembled WORKING-MEMORY context (rep + account free-text context + the
 * account semantic summary + recent raw interactions) when one was built. renderAccountKnowledge
 * is the single switch: memory context when present, else the exact pre-35c behaviour — so every
 * consumer's prompt is byte-identical to its old form whenever no memory was assembled
 * (cold start, an unassigned rep, or a consumer that didn't wire memory in).
 */

/** The cold-start note shown when an account has no summary and no assembled memory yet. */
export const COLD_START_ACCOUNT_NOTE =
  "(nothing yet — this is a cold-start account with no logged history)";

/**
 * Render the body of a consumer prompt's account-knowledge section.
 *
 * Precedence: the assembled working-memory context (Phase 35c) → the bare shared account
 * summary (pre-35c behaviour) → the cold-start note. The summary is trimmed exactly as the
 * consumers did inline, so an absent `memoryContext` reproduces the old output verbatim.
 */
export function renderAccountKnowledge(
  memoryContext: string | null | undefined,
  accountSummary: string | null | undefined,
): string {
  const mem = memoryContext?.trim();
  if (mem) return mem;
  const summary = accountSummary?.trim();
  return summary && summary.length > 0 ? summary : COLD_START_ACCOUNT_NOTE;
}
