/**
 * Style mode (Phase 19). Signal ships with TWO style modes (Signal PRD §06,
 * "Style Architecture"): the binary Assertive / Relational spectrum (a slider is a
 * v2 feature). The rep's baseline is set during intake based on their profile and
 * can be overridden per call.
 *
 *   - ASSERTIVE  → move toward a decision on THIS call; closing-oriented; silence
 *                  as a pressure tool.
 *   - RELATIONAL → secure the next conversation; discovery + personal connection;
 *                  close only when relationship equity warrants it; silence as a
 *                  space tool.
 *
 * Pure + unit-tested so the option set and the default can't silently drift.
 */

export const STYLE_MODES = ["assertive", "relational"] as const;
export type StyleMode = (typeof STYLE_MODES)[number];

/**
 * The beta default when the rep hasn't chosen and we can't derive a baseline.
 * Relational per the PRD beta build sequence ("Script generation in Relational
 * mode only" first; Assertive added alongside) and the Navarro relationship-first
 * philosophy — the safer default for a field rep guarding a long-term account.
 */
export const DEFAULT_STYLE_MODE: StyleMode = "relational";

/** Human label for a style mode (rep-facing copy; no dev jargon). */
export const STYLE_MODE_LABELS: Record<StyleMode, string> = {
  assertive: "Assertive",
  relational: "Relational",
};

export function isStyleMode(v: unknown): v is StyleMode {
  return typeof v === "string" && (STYLE_MODES as readonly string[]).includes(v);
}

/** Coerce arbitrary input to a valid style mode, falling back to a default. */
export function coerceStyleMode(
  v: unknown,
  fallback: StyleMode = DEFAULT_STYLE_MODE,
): StyleMode {
  return isStyleMode(v) ? v : fallback;
}

/**
 * The rep's baseline style mode. The PRD sets this "during intake based on their
 * profile"; there is no dedicated style question in the intake yet, so for beta the
 * baseline is DEFAULT_STYLE_MODE and the rep picks per call. This is a documented
 * SEAM (the rep profile is passed in) so a later phase can derive the real
 * intake-based baseline without touching callers — the same pattern used for the
 * cold-start call count and the interaction-count proxy.
 *
 * FLAGGED for Felix + the expert coach: wire an intake-derived baseline.
 */
export function resolveBaselineStyleMode(
  _repProfile: string | null,
): StyleMode {
  return DEFAULT_STYLE_MODE;
}
