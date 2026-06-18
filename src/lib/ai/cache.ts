/**
 * Anthropic prompt-caching layer (Phase 17). The single place Critiq builds a
 * cache-aware Claude `system` array and reads cache usage back, so every AI
 * consumer (scoring now; pre-call brief / coaching / working-memory later) caches
 * the same way instead of re-placing `cache_control` markers by hand.
 *
 * Why this exists (locked memory architecture, /critiq-context):
 *   - The locked METHODOLOGY block (SPIN/Voss/Navarro rubric + role) is identical
 *     on every call → cache it forever.
 *   - REP INTAKE is identical per rep, refreshed on update → cache it per rep, as
 *     a SECOND stable layer after the methodology.
 *   - Running summaries + the transcript are volatile → they live in `messages`,
 *     never cached.
 *
 * Prompt caching is a PREFIX match (Anthropic docs): a byte change anywhere in the
 * prefix invalidates everything after it, and render order is tools → system →
 * messages. So stable layers go first (methodology, then rep intake) and each gets
 * its OWN breakpoint — that way a rep-intake change still reads the methodology
 * cache that precedes it. `cache_control: {type:"ephemeral"}` is GA (no beta
 * header). Below a model's minimum cacheable prefix the API silently does NOT
 * cache (`cache_creation_input_tokens` stays 0) — see MIN_CACHEABLE_TOKENS.
 */

/** The cache marker. GA — no `anthropic-beta` header required. */
export const EPHEMERAL_CACHE_CONTROL = { type: "ephemeral" } as const;
export type CacheControl = typeof EPHEMERAL_CACHE_CONTROL;

/** A cached system text block, as the Messages API expects it. */
export interface SystemTextBlock {
  type: "text";
  text: string;
  cache_control?: CacheControl;
}

/**
 * Max `cache_control` breakpoints per request (Anthropic limit). Critiq uses at
 * most two stable system layers (methodology + rep intake), well under this.
 */
export const MAX_CACHE_BREAKPOINTS = 4;

/**
 * Conservative advisory floor for the cacheable prefix per model, in tokens. A
 * `system` prefix shorter than this is unlikely to cache — the API silently
 * declines (no error, `cache_creation_input_tokens` stays 0). Advisory only:
 * production logic never gates on it; it just powers a "too small to cache" warning.
 *
 * Critiq's locked model is claude-sonnet-4-6. NOTE: Anthropic's per-model doc lists
 * 2048 for Sonnet 4.6, but a Phase 17 LIVE PROBE showed Critiq's ~1567-token
 * methodology block DOES cache on claude-sonnet-4-6 (call 1 created=1560 → call 2
 * read=1560, a 90% hit rate). So 2048 over-warns; we use 1024 — the documented
 * floor that matches the observed behavior. Caching is therefore live on the
 * scoring call today, and grows further once the rep-intake / Phase 25
 * working-memory layers extend the stable prefix.
 */
export const MIN_CACHEABLE_TOKENS: Record<string, number> = {
  "claude-sonnet-4-6": 1024,
  "claude-haiku-4-5": 4096,
  "claude-opus-4-8": 4096,
  "claude-opus-4-7": 4096,
  "claude-opus-4-6": 4096,
};

/** Advisory cacheable-prefix floor for a model (default 1024 for unknown models). */
export function minCacheableTokens(model: string): number {
  return MIN_CACHEABLE_TOKENS[model] ?? 1024;
}

/** One stable layer of the system prompt. Order them MOST-STABLE-FIRST. */
export interface CacheableLayer {
  /** The layer's text (e.g. the methodology block, a rep's intake summary). */
  text: string;
  /**
   * Put a cache breakpoint at the end of this layer. Default true. Set false for
   * a stable layer you deliberately don't want to spend a breakpoint on.
   */
  cache?: boolean;
}

/**
 * Build the `system` array from ordered stable layers, placing a `cache_control`
 * breakpoint at the end of each cacheable layer.
 *
 * - Empty / whitespace-only layers are dropped (an empty block can't anchor a
 *   cache and would just bloat the prefix).
 * - At most MAX_CACHE_BREAKPOINTS markers are placed; if more cacheable layers are
 *   given, the EARLIEST ones get the markers (earliest = most stable = most
 *   reused, and a later breakpoint already implies the earlier prefix is cached).
 *
 * The result is safe to pass straight to `messages.create({ system })`.
 */
export function buildCachedSystem(layers: CacheableLayer[]): SystemTextBlock[] {
  const kept = layers.filter((l) => l.text.trim().length > 0);
  let breakpointsUsed = 0;
  return kept.map((layer) => {
    const block: SystemTextBlock = { type: "text", text: layer.text };
    const wantsCache = layer.cache !== false;
    if (wantsCache && breakpointsUsed < MAX_CACHE_BREAKPOINTS) {
      block.cache_control = EPHEMERAL_CACHE_CONTROL;
      breakpointsUsed += 1;
    }
    return block;
  });
}

/** The cache-relevant subset of the Messages API `usage` object. */
export interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

/** A normalized, NaN-safe view of one call's cache activity. */
export interface CacheUsageSummary {
  /** Tokens processed at full price (the uncached remainder). */
  inputTokens: number;
  outputTokens: number;
  /** Tokens written to cache this call (~1.25× input price). */
  cacheCreationTokens: number;
  /** Tokens served from cache this call (~0.1× input price). */
  cacheReadTokens: number;
  /** input + creation + read — the true total prompt size. */
  totalPromptTokens: number;
  /** cacheReadTokens / totalPromptTokens, 0..1 (0 when there's no prompt). */
  cacheHitRate: number;
  /** True when any tokens were served from cache this call. */
  cacheHit: boolean;
}

function nonNegInt(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Summarize a response's cache activity. Tolerant of a missing/partial `usage`
 * object (all fields default to 0; never throws, never NaN). Use the result to
 * verify caching is live: if `cacheReadTokens` stays 0 across repeated
 * identical-prefix calls, a silent invalidator is at work (or the prefix is below
 * the model's minimum cacheable size).
 */
export function summarizeCacheUsage(
  usage: AnthropicUsage | undefined | null,
): CacheUsageSummary {
  const inputTokens = nonNegInt(usage?.input_tokens);
  const outputTokens = nonNegInt(usage?.output_tokens);
  const cacheCreationTokens = nonNegInt(usage?.cache_creation_input_tokens);
  const cacheReadTokens = nonNegInt(usage?.cache_read_input_tokens);
  const totalPromptTokens = inputTokens + cacheCreationTokens + cacheReadTokens;
  return {
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    totalPromptTokens,
    cacheHitRate: totalPromptTokens > 0 ? cacheReadTokens / totalPromptTokens : 0,
    cacheHit: cacheReadTokens > 0,
  };
}

/** One-line, log-friendly rendering of a cache summary (no PII — counts only). */
export function formatCacheUsage(s: CacheUsageSummary): string {
  const pct = (s.cacheHitRate * 100).toFixed(0);
  return `cache: read=${s.cacheReadTokens} created=${s.cacheCreationTokens} input=${s.inputTokens} output=${s.outputTokens} hitRate=${pct}%`;
}
