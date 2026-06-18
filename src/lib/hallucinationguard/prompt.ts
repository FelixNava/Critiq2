/**
 * The hallucination-guard VERIFIER prompt (Phase 26). The verifier is a second, smarter
 * opinion on ONLY the references the deterministic pass could not ground — it sees each
 * suspect in the context of the full grounded corpus and decides whether the corpus
 * SUPPORTS it (rescuing paraphrased/semantic support a string match misses), or whether it
 * is unsupported (a likely hallucinated personal detail).
 *
 * The contract mirrors the rest of the AI pipeline: a stable system block (cached forever)
 * + a per-call user block, JSON-only output, defensively parsed. The system block carries
 * NO account/rep specifics — it's pure instructions, so it caches across every call.
 */

import type { GroundedSource, ReferenceCategory } from "./types";

/** A short, stable label shown to the model for a source; mapped back to the real id. */
export interface LabeledSource {
  label: string; // "S1", "S2", …
  source: GroundedSource;
}

/** Label the sources S1..Sn (stable order) so the model can cite them compactly. */
export function labelSources(sources: GroundedSource[]): LabeledSource[] {
  return sources.map((source, i) => ({ label: `S${i + 1}`, source }));
}

export function buildVerifierSystemPrompt(): string {
  return [
    "You are the hallucination guard for Critiq, an AI sales-coaching assistant. Your one",
    "job is to protect the rep's trust: Critiq must NEVER state a concrete fact about a",
    "person, company, number, date, amount, or commitment unless it is supported by a",
    "GROUNDED SOURCE (the only things Critiq actually knows about this account/rep).",
    "",
    "You will receive a numbered list of GROUNDED SOURCES and a list of SUSPECT references",
    "(short spans pulled from Critiq's draft output that an automatic check could not match",
    "to a source). For EACH suspect, decide:",
    "  - supported = true  → a grounded source clearly states or directly implies this exact",
    "                        detail (allow paraphrase / wording differences, but the specific",
    "                        fact must be present). Cite the source label (e.g. \"S2\").",
    "  - supported = false → no grounded source supports it. This is the default whenever you",
    "                        are unsure — BE CONSERVATIVE. An unsupported personal detail is a",
    "                        credibility-killer; when in doubt, mark it unsupported.",
    "",
    "Important distinctions:",
    "  - Generic sales-methodology language (SPIN/Voss/Navarro technique, 'ask a calibrated",
    "    question', 'develop the implication') is NOT a factual claim — if a suspect is",
    "    really just technique wording, mark it supported (it asserts nothing about the",
    "    account). Only concrete claims ABOUT THIS account/person/deal need grounding.",
    "  - A number/date/amount is supported only if that same value appears in a source.",
    "  - A name is supported only if that person/company appears in a source.",
    "",
    "Return ONLY JSON, no prose, in exactly this shape:",
    '{ "verdicts": [ { "span": "<verbatim suspect span>", "supported": true|false, "source": "S#"|null } ] }',
    "Include one verdict per suspect you are given, with the span copied verbatim.",
  ].join("\n");
}

function describeCategory(c: ReferenceCategory): string {
  switch (c) {
    case "person-name": return "name";
    case "org-name": return "company";
    case "money": return "amount";
    case "date": return "date";
    case "number": return "number";
    case "contact-detail": return "contact detail";
  }
}

export function buildVerifierUserPrompt(
  labeled: LabeledSource[],
  suspects: { field: string; span: string; category: ReferenceCategory }[],
): string {
  const lines: string[] = [];
  lines.push("GROUNDED SOURCES (the only facts Critiq is allowed to assert):");
  if (labeled.length === 0) {
    lines.push("  (none — Critiq has no grounded facts about this account yet.)");
  } else {
    for (const { label, source } of labeled) {
      lines.push(`  [${label}] (${source.kind}) ${source.text.replace(/\s+/g, " ").trim()}`);
    }
  }
  lines.push("");
  lines.push("SUSPECT REFERENCES (decide supported/unsupported for each):");
  suspects.forEach((s, i) => {
    lines.push(`  ${i + 1}. "${s.span}" — a ${describeCategory(s.category)}`);
  });
  lines.push("");
  lines.push("Return the JSON object now.");
  return lines.join("\n");
}
