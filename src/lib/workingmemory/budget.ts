/**
 * Token budget primitives for working-memory assembly (Phase 25). Pure + deterministic
 * so the assembler's budget math is unit-tested without a model.
 *
 * Token estimation is a HEURISTIC, not a tokenizer: ~4 characters per token is the
 * standard rough rule for English text with Anthropic/OpenAI BPE tokenizers. It is
 * deliberately approximate — the working-memory budget is a guard rail to keep the prompt
 * bounded and predictable, not an exact accounting (the API's own usage numbers are the
 * ground truth, surfaced via summarizeCacheUsage). We round UP so the estimate never
 * under-counts and lets an over-budget prompt slip through.
 */

/** Characters-per-token heuristic for the estimator (English BPE rough average). */
export const CHARS_PER_TOKEN = 4;

/**
 * Default total token budget for an assembled working set. Generous enough to hold the
 * methodology block + a rep profile + an account summary + a few raw interactions, but
 * bounded so a pathological history (very long raw reports) can't blow up a prompt. The
 * methodology + rep-profile layers are cached (cheap on a hit), so most of this budget is
 * really protecting the volatile tail. Override per call via WorkingMemoryOptions.
 */
export const DEFAULT_WORKING_MEMORY_BUDGET = 6000;

/** Default number of recent raw interactions to carry (the locked "last 3"). */
export const DEFAULT_MAX_RAW_INTERACTIONS = 3;

/**
 * Don't bother truncating a block to fit a sliver of remaining budget — below this many
 * tokens the fragment is too small to be useful and just adds noise, so the block is
 * dropped instead. Keeps the squeeze from emitting "… [truncated]" stubs.
 */
export const MIN_USEFUL_TOKENS = 120;

/** Marker appended to a block that was shortened to fit the budget. */
export const TRUNCATION_MARKER = "\n… [truncated to fit working-memory budget]";

/** Estimate the token count of a string (rounded up; 0 for empty/whitespace). */
export function estimateTokens(text: string): number {
  const len = text.trim().length;
  if (len === 0) return 0;
  return Math.ceil(len / CHARS_PER_TOKEN);
}

/**
 * Shorten `text` so its estimated token count is ≤ maxTokens, cutting at a line or word
 * boundary where possible and appending the truncation marker. Returns the text unchanged
 * when it already fits. Returns "" when maxTokens leaves no room for even the marker (the
 * caller treats that as "drop the block"). Pure + deterministic.
 */
export function truncateToTokens(text: string, maxTokens: number): string {
  if (maxTokens <= 0) return "";
  if (estimateTokens(text) <= maxTokens) return text;

  const markerTokens = estimateTokens(TRUNCATION_MARKER);
  const bodyTokens = maxTokens - markerTokens;
  // No room for any meaningful body once the marker is accounted for → drop it.
  if (bodyTokens <= 0) return "";

  const maxChars = bodyTokens * CHARS_PER_TOKEN;
  let cut = text.slice(0, maxChars);

  // Prefer cutting at a line/word boundary to avoid a mid-word stub — but ONLY if that
  // boundary sits in the back half, so we never collapse the body to a sliver (which would
  // emit a block that's mostly the marker). Otherwise keep the full-length hard cut.
  const half = maxChars * 0.5;
  const lastNewline = cut.lastIndexOf("\n");
  const lastSpace = cut.lastIndexOf(" ");
  const boundary =
    lastNewline > half ? lastNewline : lastSpace > half ? lastSpace : -1;
  if (boundary > 0) cut = cut.slice(0, boundary);

  return `${cut.trimEnd()}${TRUNCATION_MARKER}`;
}
