/**
 * Guard orchestration (Phase 26). The one entry point a consumer calls. Pure except for the
 * (optional, injected) verifier — so it's fully unit-testable with a fake verifier or none.
 *
 * Flow (conservative, cost-aware):
 *   1. Detect concrete personal/specific references in each output field (deterministic).
 *   2. Ground each against the corpus (deterministic string match). Grounded → kept.
 *   3. Escalate ONLY the ungrounded references (the suspects) to the LLM verifier, if one is
 *      provided and the mode isn't "off" — it may rescue paraphrased support. Dedupe suspects
 *      by span (grounding is field-independent) so the call is as small as possible; most
 *      passes have zero suspects and make NO Claude call.
 *   4. Apply the locked policy: in conservative mode an ungrounded reference is REDACTED; in
 *      balanced it's flagged; in off nothing changes. Produce cleaned fields + a manifest.
 *
 * Fail-safe: a verifier error never throws out of here — the suspects simply stay ungrounded
 * (so conservative still redacts them, the paranoid default) and the manifest records the
 * error. The guard is therefore never weaker than its deterministic pass.
 */

import {
  buildSearchCorpus,
  detectPersonalReferences,
  groundReference,
} from "./detect";
import { DEFAULT_REDACTION_PLACEHOLDER, resolveAction } from "./policy";
import type {
  DetectedReference,
  GroundedSource,
  GuardField,
  GuardFinding,
  GuardManifest,
  GuardMode,
  GuardedOutput,
  GuardOptions,
  VerifierVerdict,
} from "./types";
import { DEFAULT_GUARD_MODE } from "./policy";

interface FieldRef {
  ref: DetectedReference;
  grounded: boolean;
  sourceId: string | null;
  basis: GuardFinding["basis"];
}

/** Apply non-overlapping redactions to a field, replacing redacted spans with the placeholder. */
function applyRedactions(
  text: string,
  refs: { ref: DetectedReference; action: GuardFinding["action"] }[],
  placeholder: string,
): string {
  // refs come from detect() already sorted by index, non-overlapping.
  const ordered = [...refs].sort((a, b) => a.ref.index - b.ref.index);
  let out = "";
  let cursor = 0;
  for (const { ref, action } of ordered) {
    if (ref.index < cursor) continue; // defensive: skip an overlap
    out += text.slice(cursor, ref.index);
    out += action === "redacted" ? placeholder : ref.span;
    cursor = ref.index + ref.span.length;
  }
  out += text.slice(cursor);
  return out;
}

/**
 * Guard a set of output fields against the grounded corpus. Returns the (possibly redacted)
 * fields keyed by their original key + a transparent manifest.
 */
export async function guardOutput(
  fields: GuardField[],
  sources: GroundedSource[],
  opts: GuardOptions = {},
): Promise<GuardedOutput> {
  const mode: GuardMode = opts.mode ?? DEFAULT_GUARD_MODE;
  const placeholder = opts.redactionPlaceholder ?? DEFAULT_REDACTION_PLACEHOLDER;
  const corpus = buildSearchCorpus(sources);

  // 1–2. Detect + deterministic grounding, per field.
  const perField: { field: GuardField; refs: FieldRef[] }[] = fields.map((field) => {
    const detected = detectPersonalReferences(field.text);
    const refs: FieldRef[] = detected.map((ref) => {
      const { grounded, sourceId } = groundReference(ref, corpus);
      return {
        ref,
        grounded,
        sourceId,
        basis: grounded ? "deterministic" : "none",
      };
    });
    return { field, refs };
  });

  // 3. Escalate the deterministically-ungrounded suspects (deduped by span) to the verifier.
  let verifierUsed = false;
  let verifierError: string | null = null;
  const verdictBySpan = new Map<string, VerifierVerdict>();
  if (mode !== "off" && opts.verifier) {
    const seen = new Set<string>();
    const suspects: { field: string; span: string; category: FieldRef["ref"]["category"] }[] =
      [];
    for (const { field, refs } of perField) {
      for (const fr of refs) {
        if (fr.grounded) continue;
        if (seen.has(fr.ref.span)) continue;
        seen.add(fr.ref.span);
        suspects.push({ field: field.key, span: fr.ref.span, category: fr.ref.category });
      }
    }
    if (suspects.length > 0) {
      verifierUsed = true;
      try {
        const verdicts = await opts.verifier.verify({ sources, suspects });
        for (const v of verdicts) verdictBySpan.set(v.span.trim(), v);
      } catch (e) {
        verifierError = e instanceof Error ? e.message : String(e);
      }
    }
  }

  // Fold any verifier rescue back into the per-field grounding.
  if (verdictBySpan.size > 0) {
    for (const { refs } of perField) {
      for (const fr of refs) {
        if (fr.grounded) continue;
        const v = verdictBySpan.get(fr.ref.span.trim());
        if (v && v.supported) {
          fr.grounded = true;
          fr.sourceId = v.sourceId;
          fr.basis = "verifier";
        }
      }
    }
  }

  // 4. Apply policy → findings + cleaned fields.
  const findings: GuardFinding[] = [];
  const outFields: Record<string, string> = {};
  let referencesDetected = 0;
  let referencesGrounded = 0;
  let referencesRedacted = 0;
  let referencesFlagged = 0;

  for (const { field, refs } of perField) {
    const actioned: { ref: DetectedReference; action: GuardFinding["action"] }[] = [];
    for (const fr of refs) {
      referencesDetected += 1;
      if (fr.grounded) referencesGrounded += 1;
      const action = resolveAction(mode, fr.grounded);
      if (action === "redacted") referencesRedacted += 1;
      if (action === "flagged") referencesFlagged += 1;
      actioned.push({ ref: fr.ref, action });
      findings.push({
        field: field.key,
        span: fr.ref.span,
        category: fr.ref.category,
        grounded: fr.grounded,
        sourceId: fr.sourceId,
        action,
        basis: fr.basis,
      });
    }
    outFields[field.key] = applyRedactions(field.text, actioned, placeholder);
  }

  const manifest: GuardManifest = {
    mode,
    fieldsChecked: fields.length,
    referencesDetected,
    referencesGrounded,
    referencesRedacted,
    referencesFlagged,
    verifierUsed,
    verifierError,
    findings,
  };

  return { fields: outFields, manifest };
}

/** A compact, PII-free one-line manifest summary for logs (counts only — no spans). */
export function formatGuardManifest(m: GuardManifest): string {
  return (
    `guard[${m.mode}]: fields=${m.fieldsChecked} refs=${m.referencesDetected} ` +
    `grounded=${m.referencesGrounded} redacted=${m.referencesRedacted} ` +
    `flagged=${m.referencesFlagged} verifier=${m.verifierUsed ? "yes" : "no"}` +
    (m.verifierError ? ` verifierError=1` : "")
  );
}
