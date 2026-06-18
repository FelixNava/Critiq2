/**
 * The canonical METHODOLOGY block for working memory (Phase 25) — the "+ rubric" layer of
 * the locked working set.
 *
 * Built from src/lib/scoring/rubric.ts (the SINGLE SOURCE OF TRUTH for the three pillars),
 * so it can never drift from the scoring rubric. Unlike the scoring prompt's system block
 * (src/lib/scoring/prompt.ts), this carries NO scoring-specific output contract — working
 * memory feeds many call types (prep, script, coaching), not just scoring, so the shared
 * layer is the methodology definitions + the coaching frame only. Each consumer adds its
 * own task instructions and output format on top.
 *
 * Pure + deterministic (fixed pillar/dimension order from the rubric) → byte-identical
 * across every call → this is the layer that caches FOREVER (src/lib/ai/cache.ts).
 */

import {
  PILLARS,
  dimensionsForPillar,
  OVERALL_MAX,
  type PillarKey,
} from "@/lib/scoring/rubric";

/**
 * Build the locked methodology block: the role + the full SPIN/Voss/Navarro rubric with
 * each sub-dimension's behavioral criteria. Stable across all calls and all reps.
 */
export function buildMethodologyBlock(): string {
  const pillarBlocks = (Object.keys(PILLARS) as PillarKey[])
    .map((pk) => {
      const p = PILLARS[pk];
      const dims = dimensionsForPillar(pk)
        .map((d) => `  - ${d.name} (0–${d.maxPoints} pts): ${d.criteria}`)
        .join("\n");
      return `${p.name} — ${p.maxPoints} points. ${p.focus}\n${dims}`;
    })
    .join("\n\n");

  return [
    "You are Critiq, an AI sales coach for field sales representatives. You learn the rep, not just the role: you adapt to how each rep sells and to the history of each account, and your guidance compounds over time.",
    "",
    `Your methodology is a three-pillar model that evaluates a sales conversation out of ${OVERALL_MAX} points. Use it as the lens for everything you do — preparing a call, scripting it, debriefing it, and coaching from it.`,
    "",
    "THE THREE PILLARS:",
    "",
    pillarBlocks,
    "",
    "GROUNDING RULE: Base everything you say on what you can actually trace to the rep's intake, this account's history, and the raw interactions provided. Never invent personal details, prior commitments, or facts about the buyer that are not grounded in that material.",
  ].join("\n");
}
