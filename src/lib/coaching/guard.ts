/**
 * Coaching ⇄ hallucination-guard adapter (Phase 26). Maps a CoachingResult through the
 * generic guard (src/lib/hallucinationguard) and applies the conservative CONSUMER policy:
 *
 *   - A coaching PRIORITY or REINFORCEMENT whose text contains a redacted (ungrounded)
 *     personal reference is DROPPED entirely. Advice that hinges on a fact Critiq can't
 *     trace to a real interaction shouldn't be given at all — a mangled sentence is worse
 *     than one fewer point.
 *   - The free-form nextStep / summary are never dropped (losing them loses the takeaway);
 *     an ungrounded span inside them is inline-redacted instead.
 *
 * Pure except for the (injected) verifier. The grounded corpus is read by the caller
 * (generate.ts) and passed in, so this stays unit-testable without a DB.
 */

import { guardOutput } from "@/lib/hallucinationguard/guard";
import type {
  GroundedSource,
  GuardField,
  GuardManifest,
  GuardMode,
  GuardVerifier,
} from "@/lib/hallucinationguard/types";
import type { CoachingResult } from "./types";

export interface GuardedCoaching {
  result: CoachingResult;
  manifest: GuardManifest;
  /** Coaching points dropped because they hinged on an ungrounded personal reference. */
  prioritiesDropped: number;
  reinforcementsDropped: number;
}

export interface GuardCoachingOptions {
  mode?: GuardMode;
  verifier?: GuardVerifier;
}

/** Guard a coaching result against the grounded corpus; returns the cleaned result + manifest. */
export async function guardCoachingResult(
  result: CoachingResult,
  sources: GroundedSource[],
  opts: GuardCoachingOptions = {},
): Promise<GuardedCoaching> {
  const fields: GuardField[] = [];
  result.priorities.forEach((p, i) => {
    fields.push({ key: `priority.${i}.focus`, text: p.focus });
    fields.push({ key: `priority.${i}.action`, text: p.action });
  });
  result.reinforce.forEach((r, i) => {
    fields.push({ key: `reinforce.${i}.focus`, text: r.focus });
    fields.push({ key: `reinforce.${i}.note`, text: r.note });
  });
  fields.push({ key: "nextStep", text: result.nextStep });
  fields.push({ key: "summary", text: result.summary });

  const guarded = await guardOutput(fields, sources, {
    mode: opts.mode,
    verifier: opts.verifier,
  });

  const redactedKeys = new Set(
    guarded.manifest.findings
      .filter((f) => f.action === "redacted")
      .map((f) => f.field),
  );

  // Drop a priority/reinforcement if ANY of its fields had a redaction.
  let prioritiesDropped = 0;
  const priorities = result.priorities
    .map((p, i) => ({
      ...p,
      focus: guarded.fields[`priority.${i}.focus`] ?? p.focus,
      action: guarded.fields[`priority.${i}.action`] ?? p.action,
    }))
    .filter((_, i) => {
      const dropped =
        redactedKeys.has(`priority.${i}.focus`) ||
        redactedKeys.has(`priority.${i}.action`);
      if (dropped) prioritiesDropped += 1;
      return !dropped;
    });

  let reinforcementsDropped = 0;
  const reinforce = result.reinforce
    .map((r, i) => ({
      ...r,
      focus: guarded.fields[`reinforce.${i}.focus`] ?? r.focus,
      note: guarded.fields[`reinforce.${i}.note`] ?? r.note,
    }))
    .filter((_, i) => {
      const dropped =
        redactedKeys.has(`reinforce.${i}.focus`) ||
        redactedKeys.has(`reinforce.${i}.note`);
      if (dropped) reinforcementsDropped += 1;
      return !dropped;
    });

  return {
    result: {
      priorities,
      reinforce,
      // nextStep / summary keep their inline-redacted text (never dropped wholesale).
      nextStep: guarded.fields["nextStep"] ?? result.nextStep,
      summary: guarded.fields["summary"] ?? result.summary,
    },
    manifest: guarded.manifest,
    prioritiesDropped,
    reinforcementsDropped,
  };
}
