/**
 * Hallucination Guard (Phase 26) — public surface. The conservative pre-output validator
 * that strips unsourced personal references before AI output reaches the rep. See types.ts
 * for the architecture; guardOutput() is the entry point, buildGroundedSources() builds the
 * corpus from the existing memory tiers, and AnthropicGuardVerifier is the LLM second opinion.
 */

export * from "./types";
export {
  DEFAULT_GUARD_MODE,
  DEFAULT_REDACTION_PLACEHOLDER,
  resolveGuardMode,
  resolveAction,
} from "./policy";
export {
  detectPersonalReferences,
  groundReference,
  buildSearchCorpus,
  normalizeForMatch,
} from "./detect";
export { guardOutput, formatGuardManifest } from "./guard";
export {
  buildGroundedSources,
  GROUNDING_MAX_RAW_INTERACTIONS,
} from "./sources";
export {
  AnthropicGuardVerifier,
  GuardVerifierError,
  buildVerifierRequest,
  extractVerdictsFromResponse,
  parseVerifierVerdicts,
  GUARD_VERIFIER_MODEL,
} from "./anthropic";
export {
  buildVerifierSystemPrompt,
  buildVerifierUserPrompt,
  labelSources,
} from "./prompt";
