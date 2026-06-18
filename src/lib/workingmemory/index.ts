/**
 * Working memory assembly (Phase 25) — the WORKING tier of the locked memory architecture.
 * Public surface: the builder + the pure assembler + the budget/methodology primitives.
 */

export { buildWorkingMemory } from "./build";
export { assembleWorkingMemory } from "./assemble";
export { buildMethodologyBlock, METHODOLOGY_BLOCK } from "./methodology";
export {
  DEFAULT_WORKING_MEMORY_BUDGET,
  DEFAULT_MAX_RAW_INTERACTIONS,
  estimateTokens,
  truncateToTokens,
} from "./budget";
export type {
  WorkingMemory,
  WorkingMemoryManifest,
  WorkingMemoryOptions,
  WorkingMemorySources,
  WorkingMemoryLayerInfo,
  RawInteraction,
  RepProfileSource,
} from "./types";
