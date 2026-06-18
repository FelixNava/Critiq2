/**
 * Hallucination Guard types (Phase 26 — the credibility guardrail).
 *
 * The locked decision (CLAUDE.md "AI Pipeline" + /critiq-context): "Hallucination guard:
 * CONSERVATIVE for beta. Never surface personal details unless source-tagged with the
 * originating interaction ID. Pre-output validator strips unsourced personal references.
 * THIS IS THE CREDIBILITY-KILLER — be paranoid."
 *
 * So the guard sits BETWEEN an AI consumer's output (coaching, a brief, a script) and the
 * rep. It takes (a) the candidate output text fields and (b) the GROUNDED CORPUS — the
 * source-tagged facts/traits/raw interactions Critiq is actually allowed to assert about
 * this account/rep (Phase 23 `account_summaries.facts`, Phase 24 `rep_summaries.traits`,
 * Phase 25's recent raw interactions, each carrying the originating debrief id) — and it
 * REDACTS any concrete personal/specific reference in the output that no grounded source
 * supports. Generic sales-methodology advice (SPIN/Voss/Navarro technique) is never touched;
 * only factual claims about THIS person/account.
 *
 * Design (mirrors the established module shape — pure core, DI seam, transparent record):
 *   - detect.ts  — PURE detector of personal/specific references + a deterministic grounding
 *                  check (string-level). The fail-safe backbone: works with zero LLM.
 *   - prompt.ts/anthropic.ts — the LLM verifier (claude-sonnet-4-6, no SDK). It only sees
 *                  the references the deterministic pass could NOT ground, and may rescue the
 *                  ones the string match missed (paraphrase/semantic support).
 *   - policy.ts  — the locked conservative decision: ungrounded ⇒ redact.
 *   - guard.ts   — orchestration: detect → (escalate only the suspects to the verifier) →
 *                  apply policy → produce cleaned fields + a transparent manifest.
 *   - sources.ts — build the grounded corpus from the existing tiers (the only impure part).
 *
 * NO new table, NO migration, NO API route, NO UI. The guard runs in-memory inside the
 * consumer's request and logs its manifest (counts only, no PII — the Phase 17 telemetry
 * posture). Additive — zero data-loss risk.
 */

/**
 * How aggressively the guard treats an ungrounded personal reference. CONSERVATIVE is the
 * locked beta default (be paranoid):
 *   - conservative — ungrounded references are REDACTED out of the output.
 *   - balanced     — ungrounded references are FLAGGED (kept in text, recorded in the
 *                    manifest) but not stripped — for tuning / observing without redacting.
 *   - off          — the guard observes + records but changes nothing (a kill-switch).
 */
export type GuardMode = "conservative" | "balanced" | "off";

/** What kind of grounded material a source is (provenance + how strictly it grounds). */
export type GroundedSourceKind =
  | "account-fact" // Phase 23 attributed account fact (sourceDebriefId)
  | "rep-trait" // Phase 24 attributed rep trait (sourceDebriefId)
  | "raw-interaction" // Phase 25 verbatim debrief report (debriefId)
  | "account-summary"; // the account running narrative/headline (Phase 23 write-back)

/**
 * One unit of grounded truth Critiq is allowed to assert. `id` is the ORIGINATING
 * interaction id the locked decision requires (a debrief id for facts/traits/raw; a stable
 * label for the account summary). `text` is the supporting content the guard matches against.
 */
export interface GroundedSource {
  id: string;
  kind: GroundedSourceKind;
  text: string;
}

/** A labeled output field to guard (e.g. { key: "nextStep", text: "Call Bob at 555-1234" }). */
export interface GuardField {
  key: string;
  text: string;
}

/** The class of a detected personal/specific reference (drives detection + the manifest). */
export type ReferenceCategory =
  | "person-name"
  | "org-name"
  | "number"
  | "date"
  | "money"
  | "contact-detail"; // email / phone

/** A concrete personal/specific reference detected inside an output field. */
export interface DetectedReference {
  /** The exact substring as it appears in the field (used for redaction). */
  span: string;
  category: ReferenceCategory;
  /** Character offset of the span in the field text (for ordered, non-overlapping redaction). */
  index: number;
}

/** What the guard decided about one reference. */
export type GuardAction = "kept" | "redacted" | "flagged";

/** A per-reference record of the guard's decision — the audit trail. */
export interface GuardFinding {
  field: string;
  span: string;
  category: ReferenceCategory;
  /** Whether a grounded source ultimately supported the reference. */
  grounded: boolean;
  /** The originating source id when grounded, else null. */
  sourceId: string | null;
  action: GuardAction;
  /** How grounding was decided: the deterministic match, the verifier, or neither. */
  basis: "deterministic" | "verifier" | "none";
}

/**
 * A transparent record of everything the guard did — every reference checked, how it was
 * grounded, and what happened to it. Logged by the consumer (counts only; spans are PII-ish
 * so the consumer logs aggregates, not the findings array). No silent strips.
 */
export interface GuardManifest {
  mode: GuardMode;
  fieldsChecked: number;
  referencesDetected: number;
  referencesGrounded: number;
  referencesRedacted: number;
  referencesFlagged: number;
  /** True when the LLM verifier was actually invoked (only when suspects existed). */
  verifierUsed: boolean;
  /** Set when the verifier was asked but failed; the guard then fell back to conservative. */
  verifierError: string | null;
  findings: GuardFinding[];
}

/** The guard's output: the (possibly redacted) fields by key + the manifest. */
export interface GuardedOutput {
  fields: Record<string, string>;
  manifest: GuardManifest;
}

/**
 * The LLM verifier's verdict on ONE suspect reference. `supported` rescues a reference the
 * string match missed (paraphrase/semantic support); conservative mode redacts the rest.
 */
export interface VerifierVerdict {
  field: string;
  span: string;
  supported: boolean;
  sourceId: string | null;
}

/** One suspect reference handed to the verifier (deterministically ungrounded). */
export interface VerifierSuspect {
  field: string;
  span: string;
  category: ReferenceCategory;
  /** The full output field the span appears in — so the verifier judges it IN CONTEXT, not
   *  as a bare token (a name/number means different things in different sentences). */
  context: string;
}

/** The set of suspect references handed to the verifier. */
export interface VerifierRequest {
  sources: GroundedSource[];
  suspects: VerifierSuspect[];
}

/** DI seam for the LLM verifier (real impl in anthropic.ts; a fake in tests). */
export interface GuardVerifier {
  verify(request: VerifierRequest): Promise<VerifierVerdict[]>;
}

/** Options for a single guard pass. */
export interface GuardOptions {
  mode?: GuardMode;
  /** The LLM verifier. When omitted, the guard relies on the deterministic pass alone. */
  verifier?: GuardVerifier;
  /** What an ungrounded span is replaced with in conservative mode. */
  redactionPlaceholder?: string;
}
