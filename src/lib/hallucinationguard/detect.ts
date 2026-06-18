/**
 * The PURE detector + deterministic grounding check (Phase 26). This is the fail-safe
 * backbone of the guard: it finds concrete personal/specific references in output text and
 * decides, by string-level matching against the grounded corpus, whether each is supported.
 * It runs with ZERO LLM, so even if the verifier is unreachable the guard still strips
 * obviously-ungrounded personal details (conservative = never weaker than this pass).
 *
 * Precision-over-recall by design: the detector targets the high-credibility-risk categories
 * (names, contact details, money, dates, percentages, large numbers) and deliberately leaves
 * generic sales-methodology language alone (a curated stoplist). The LLM verifier (anthropic.ts)
 * adds recall on the references this pass cannot ground — it sees the suspects in context and
 * can rescue paraphrased support the string match misses.
 */

import type { DetectedReference, GroundedSource, ReferenceCategory } from "./types";

// ---------------------------------------------------------------------------
// Stoplist — capitalized tokens that are NOT account/person facts and must never be
// treated as personal references: methodology + the pillar/lens vocabulary + common
// sentence-initial / connective words. (Lowercased for comparison.)
// ---------------------------------------------------------------------------
const STOPWORDS = new Set<string>([
  // Methodology / product / pillar + sub-dimension vocabulary (capitalized in copy).
  "critiq", "signal", "spin", "voss", "navarro",
  "situation", "problem", "implication", "need", "payoff",
  "mirroring", "labeling", "calibrated", "tactical", "empathy",
  "silence", "pacing", "genuine", "curiosity", "long", "term", "orientation",
  "territory", "command", "structure", "communication", "relationship", "general",
  // Common capitalized-at-sentence-start / connective words.
  "the", "a", "an", "and", "or", "but", "so", "if", "then", "this", "that",
  "these", "those", "their", "they", "them", "your", "you", "his", "her", "its",
  "call", "ask", "tell", "open", "close", "lead", "listen", "build", "develop",
  "use", "try", "keep", "make", "let", "next", "when", "where", "why", "how",
  // Common coaching imperative verbs (often sentence-initial + capitalized in advice).
  "email", "send", "schedule", "confirm", "lock", "quantify", "loop", "follow",
  "set", "share", "bring", "walk", "raise", "reframe", "propose", "position",
  "mirror", "label", "name", "frame", "surface", "address", "revisit", "good",
  "strong", "great", "nice", "consider", "review", "prepare", "prep", "map",
  "anchor", "acknowledge", "summarize", "clarify", "validate", "explore", "probe",
  "what", "who", "before", "after", "during", "while", "buyer", "buyers", "client",
  "account", "contact", "deal", "team", "rep", "step", "steps", "note", "focus",
  "i", "we", "it", "he", "she", "do", "be", "get", "go", "now", "for", "to", "of",
  "on", "in", "at", "by", "with", "without", "about", "into", "from", "as", "is",
  "are", "was", "were", "will", "would", "should", "could", "can", "may", "might",
  "yes", "no", "not", "more", "most", "less", "least", "each", "every", "some",
  "any", "all", "both", "either", "neither", "one", "two", "three",
]);

/** Words that, if present in a multi-token cap run, mark it an organization. */
const ORG_MARKERS = new Set<string>([
  "inc", "llc", "corp", "co", "ltd", "company", "group", "industries", "partners",
  "supply", "supplies", "paint", "paints", "decor", "coatings", "construction",
  "contractors", "builders", "associates", "enterprises", "holdings", "systems",
  "solutions", "services", "store", "stores",
]);

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
// Phone: 7+ digits with common separators, optional country/area grouping.
const PHONE_RE = /(?:\+?\d[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)?\d{3}[\s.-]?\d{4}\b/g;
const MONEY_RE = /\$\s?\d[\d,]*(?:\.\d+)?\s?(?:k|m|b)?\b/gi;
const PERCENT_RE = /\b\d+(?:\.\d+)?\s?%/g;
const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/g;
const NUM_DATE_RE = /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g;
const QUARTER_RE = /\bQ[1-4](?:[\s-]?\d{2,4})?\b/g;
const MONTH_RE =
  /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b(?:\s+\d{1,2}(?:st|nd|rd|th)?)?(?:,?\s+\d{4})?/g;
// Large standalone numbers (years, quantities ≥ 4 digits) not otherwise categorized.
const BIG_NUM_RE = /\b\d{4,}\b/g;
// A run of Capitalized tokens (proper-noun candidate). Allows internal apostrophes/hyphens.
const CAP_RUN_RE = /\b[A-Z][a-zA-Z'’.-]*(?:\s+[A-Z][a-zA-Z'’.-]*)*\b/g;

interface RawMatch {
  span: string;
  index: number;
  category: ReferenceCategory;
}

function collect(
  text: string,
  re: RegExp,
  category: ReferenceCategory,
  out: RawMatch[],
): void {
  for (const m of text.matchAll(re)) {
    const span = m[0].trim();
    if (span) out.push({ span, index: m.index ?? 0, category });
  }
}

/**
 * Detect concrete personal/specific references in one field of output. Ordered by position,
 * de-overlapped (an earlier, higher-priority match wins over a later overlapping one — e.g.
 * a money/percentage span beats a bare big-number span at the same spot).
 */
export function detectPersonalReferences(text: string): DetectedReference[] {
  if (!text || !text.trim()) return [];
  const raw: RawMatch[] = [];

  // High-precision categories first (these win overlaps).
  collect(text, EMAIL_RE, "contact-detail", raw);
  collect(text, PHONE_RE, "contact-detail", raw);
  collect(text, MONEY_RE, "money", raw);
  collect(text, PERCENT_RE, "number", raw);
  collect(text, ISO_DATE_RE, "date", raw);
  collect(text, NUM_DATE_RE, "date", raw);
  collect(text, QUARTER_RE, "date", raw);
  collect(text, MONTH_RE, "date", raw);
  collect(text, BIG_NUM_RE, "number", raw);

  // Proper-noun runs → person/org, minus the stoplist. Leading/trailing stopword tokens
  // (e.g. the verb in "Ask Dana", the connective in "Call Bob now") are trimmed off so the
  // detected span is just the name ("Dana", "Bob") — tighter detection + tighter redaction.
  for (const m of text.matchAll(CAP_RUN_RE)) {
    const runStart = m.index ?? 0;
    // Tokens with their absolute offsets within the field.
    const toks: { word: string; start: number; end: number }[] = [];
    for (const tm of m[0].matchAll(/[A-Z][a-zA-Z'’.-]*/g)) {
      const start = runStart + (tm.index ?? 0);
      toks.push({ word: tm[0], start, end: start + tm[0].length });
    }
    const norm = (w: string) => w.replace(/[.'’-]+$/g, "").toLowerCase();
    // Trim leading + trailing stopword tokens.
    let lo = 0;
    let hi = toks.length - 1;
    while (lo <= hi && STOPWORDS.has(norm(toks[lo].word))) lo += 1;
    while (hi >= lo && STOPWORDS.has(norm(toks[hi].word))) hi -= 1;
    if (lo > hi) continue; // every token was a stopword
    const kept = toks.slice(lo, hi + 1);
    // Require at least one non-stopword token among the kept (else it's all common words).
    if (kept.every((t) => STOPWORDS.has(norm(t.word)))) continue;
    const start = kept[0].start;
    const end = kept[kept.length - 1].end;
    // A lone capitalized word at the START of a sentence is ordinary capitalization (a verb
    // like "Confirm…", "Email…"), not a name. Drop single-token sentence-initial candidates;
    // multi-token runs ("Bob Stevens", "Park Avenue Paint") are kept even sentence-initially.
    // (Precision over recall: a sentence-initial lone first name may be missed — flagged.)
    if (kept.length === 1) {
      const before = text.slice(0, start).replace(/\s+$/, "");
      if (before === "" || /[.!?:;]$/.test(before)) continue;
    }
    const span = text.slice(start, end);
    const category: ReferenceCategory = kept.some((t) => ORG_MARKERS.has(norm(t.word)))
      ? "org-name"
      : "person-name";
    raw.push({ span, index: start, category });
  }

  // Sort by start, then by descending length (longer/higher-precision wins an overlap).
  raw.sort((a, b) => a.index - b.index || b.span.length - a.span.length);

  const chosen: DetectedReference[] = [];
  let consumedUntil = -1;
  // Category precedence when two matches start at the same index.
  const PRIORITY: Record<ReferenceCategory, number> = {
    "contact-detail": 5,
    money: 4,
    date: 3,
    number: 2,
    "org-name": 1,
    "person-name": 1,
  };
  for (const m of raw) {
    const end = m.index + m.span.length;
    if (m.index < consumedUntil) {
      // Overlaps an already-chosen span: only replace if it starts at the same index and
      // has strictly higher priority AND is at least as long (keep it simple — skip).
      const prev = chosen[chosen.length - 1];
      if (
        prev &&
        prev.index === m.index &&
        PRIORITY[m.category] > PRIORITY[prev.category] &&
        m.span.length >= prev.span.length
      ) {
        chosen[chosen.length - 1] = { span: m.span, category: m.category, index: m.index };
        consumedUntil = Math.max(consumedUntil, end);
      }
      continue;
    }
    chosen.push({ span: m.span, category: m.category, index: m.index });
    consumedUntil = end;
  }
  return chosen;
}

// ---------------------------------------------------------------------------
// Deterministic grounding
// ---------------------------------------------------------------------------

/** Normalize text for matching: lowercase, collapse non-alphanumerics (keep % ) to spaces. */
export function normalizeForMatch(s: string): string {
  return ` ${s.toLowerCase().replace(/[^a-z0-9%]+/g, " ").replace(/\s+/g, " ").trim()} `;
}

/** Digits-and-percent core of a numeric/contact span (e.g. "$5,000" → "5000", "27 %" → "27%"). */
function numericCore(span: string): string {
  const pct = /%/.test(span) ? "%" : "";
  const digits = span.replace(/[^0-9]/g, "");
  return digits + pct;
}

/** Build a normalized search corpus once per grounding pass (perf + consistency). */
export function buildSearchCorpus(sources: GroundedSource[]): { id: string; norm: string }[] {
  return sources
    .filter((s) => s.text && s.text.trim())
    .map((s) => ({ id: s.id, norm: normalizeForMatch(s.text) }));
}

/**
 * Is this reference supported by some grounded source (string-level)? Returns the supporting
 * source id or null. Names/orgs require their full normalized span as a substring of a
 * source; numeric/date/contact references require their digit-core (or normalized span) to
 * appear. Conservative: a partial/looser match does NOT ground.
 */
export function groundReference(
  ref: { span: string; category: ReferenceCategory },
  corpus: { id: string; norm: string }[],
): { grounded: boolean; sourceId: string | null } {
  let needle: string;
  if (ref.category === "person-name" || ref.category === "org-name") {
    needle = normalizeForMatch(ref.span).trim();
  } else {
    const core = numericCore(ref.span);
    // A numeric reference with no digits (shouldn't happen) can't be grounded.
    if (!core.replace("%", "")) return { grounded: false, sourceId: null };
    needle = core;
  }
  if (!needle) return { grounded: false, sourceId: null };
  for (const src of corpus) {
    // Wrap names with spaces already (normalizeForMatch pads); numeric cores match raw.
    const hay = ref.category === "person-name" || ref.category === "org-name"
      ? src.norm
      : src.norm.replace(/\s+/g, "");
    const probe = ref.category === "person-name" || ref.category === "org-name"
      ? ` ${needle} `
      : needle.replace(/\s+/g, "");
    if (hay.includes(probe)) return { grounded: true, sourceId: src.id };
  }
  return { grounded: false, sourceId: null };
}
