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
// Standalone multi-digit numbers (years, quantities, counts ≥ 2 digits) not otherwise
// categorized. 2+ so fabricated quantities ("85 gallons", a "40-unit complex") are checked;
// bare single digits are intentionally NOT detected (too noisy — generic counts like "3
// priorities"). Single-digit blind spot is a documented limitation.
const BIG_NUM_RE = /\b\d{2,}\b/g;
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

  // De-overlap with one greedy pass: sort by start, then higher-precision category, then
  // longer span; walk left-to-right taking each match that starts at/after the last one's
  // end. So at a shared start the highest-precision longest span wins (e.g. a "$5,000" money
  // span beats the bare "5000" number span inside it) and the inner one is skipped.
  const PRIORITY: Record<ReferenceCategory, number> = {
    "contact-detail": 5,
    money: 4,
    date: 3,
    number: 2,
    "org-name": 1,
    "person-name": 1,
  };
  raw.sort(
    (a, b) =>
      a.index - b.index ||
      PRIORITY[b.category] - PRIORITY[a.category] ||
      b.span.length - a.span.length,
  );
  const chosen: DetectedReference[] = [];
  let consumedUntil = -1;
  for (const m of raw) {
    if (m.index < consumedUntil) continue; // overlaps an already-chosen span
    chosen.push({ span: m.span, category: m.category, index: m.index });
    consumedUntil = m.index + m.span.length;
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

/**
 * Normalize ONE numeric-ish token to a canonical value string so equal magnitudes compare
 * equal regardless of formatting: strips $ + commas, expands a k/m/b magnitude suffix,
 * canonicalizes leading zeros ("07" → "7"), and preserves a percent flag ("27%"). Returns ""
 * if the token isn't a clean number. e.g. "$5,000" → "5000", "5k" → "5000", "1.5m" →
 * "1500000", "27 %" → "27%", "07" → "7".
 */
export function normalizeNumericToken(raw: string): string {
  let s = raw.toLowerCase().replace(/\$/g, "").replace(/,/g, "").trim();
  const pct = /%/.test(s);
  s = s.replace(/%/g, "").trim();
  let mult = 1;
  const mag = s.match(/(k|m|b)\s*$/);
  if (mag) {
    mult = mag[1] === "k" ? 1e3 : mag[1] === "m" ? 1e6 : 1e9;
    s = s.replace(/(k|m|b)\s*$/, "").trim();
  }
  if (!/^\d*\.?\d+$/.test(s)) return "";
  const val = Number(s) * mult;
  if (!Number.isFinite(val)) return "";
  return pct ? `${val}%` : String(val);
}

/** Token regex covering money / percent / plain numbers (with optional magnitude). The
 *  percent alternative is first; neither alternative starts with optional whitespace (a
 *  leading \s? would match the space BEFORE a number and stop short of a trailing %). */
const NUM_TOKEN_RE = /\d[\d,]*(?:\.\d+)?\s?(?:k|m|b)?\s?%|\$?\d[\d,]*(?:\.\d+)?\s?(?:k|m|b)?/gi;

/** Extract the set of canonical numeric tokens a source asserts (bounded — no substring soup). */
function extractSourceNumbers(text: string): Set<string> {
  const set = new Set<string>();
  for (const m of text.matchAll(NUM_TOKEN_RE)) {
    const t = normalizeNumericToken(m[0]);
    if (t) set.add(t);
  }
  // Phone numbers as their raw digit run (so a contact detail grounds on the whole number,
  // not a substring of a longer figure).
  for (const m of text.matchAll(PHONE_RE)) {
    const d = m[0].replace(/\D/g, "");
    if (d) set.add(d);
  }
  return set;
}

/** A source preprocessed for matching: padded text (names) + its canonical numeric tokens. */
export interface SearchSource {
  id: string;
  norm: string;
  numbers: Set<string>;
}

/** Build the search corpus once per grounding pass (names via text, numbers via a token set). */
export function buildSearchCorpus(sources: GroundedSource[]): SearchSource[] {
  return sources
    .filter((s) => s.text && s.text.trim())
    .map((s) => ({
      id: s.id,
      norm: normalizeForMatch(s.text),
      numbers: extractSourceNumbers(s.text),
    }));
}

/** Ground a DATE span: a quarter ("Q3") by token; otherwise EVERY numeric component (and the
 *  month word, if any) must appear in ONE source. Cross-format safe ("2026-07-15" grounds on
 *  a source that says "07/15/2026"). Conservative: a partial component match does not ground. */
function groundDate(
  span: string,
  corpus: SearchSource[],
): { grounded: boolean; sourceId: string | null } {
  const lower = span.toLowerCase();
  const quarter = lower.match(/q[1-4]/);
  const isPureQuarter = quarter !== null && !/\d{1,2}[/-]\d/.test(span);
  const monthMatch = lower.match(
    /jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/,
  );
  const nums = (span.match(/\d+/g) ?? []).map((n) => String(Number(n)));
  for (const src of corpus) {
    if (isPureQuarter && quarter) {
      if (!src.norm.includes(` ${quarter[0]} `)) continue;
      const yr = span.match(/\d{4}/);
      if (!yr || src.numbers.has(String(Number(yr[0])))) {
        return { grounded: true, sourceId: src.id };
      }
      continue;
    }
    const monthOk = !monthMatch || src.norm.includes(monthMatch[0]);
    const numsOk = nums.every((n) => src.numbers.has(n));
    if (monthOk && numsOk && (monthMatch !== null || nums.length > 0)) {
      return { grounded: true, sourceId: src.id };
    }
  }
  return { grounded: false, sourceId: null };
}

/**
 * Is this reference supported by some grounded source? Returns the supporting source id or
 * null. Names/orgs require their full normalized span as a bounded substring; numbers/money/
 * percentages require an EXACT canonical-token match (so "27%" is NOT grounded by "127%", and
 * "$500" is NOT grounded by "$1,500"); dates match by component; contact details by the whole
 * value. Conservative: a partial/looser match does NOT ground.
 */
export function groundReference(
  ref: { span: string; category: ReferenceCategory },
  corpus: SearchSource[],
): { grounded: boolean; sourceId: string | null } {
  const cat = ref.category;

  if (cat === "person-name" || cat === "org-name") {
    const needle = normalizeForMatch(ref.span).trim();
    if (!needle) return { grounded: false, sourceId: null };
    for (const src of corpus) {
      if (src.norm.includes(` ${needle} `)) return { grounded: true, sourceId: src.id };
    }
    return { grounded: false, sourceId: null };
  }

  if (cat === "contact-detail") {
    if (ref.span.includes("@")) {
      const needle = ref.span.toLowerCase().trim();
      for (const src of corpus) {
        if (src.norm.includes(needle)) return { grounded: true, sourceId: src.id };
      }
      return { grounded: false, sourceId: null };
    }
    const digits = ref.span.replace(/\D/g, "");
    if (!digits) return { grounded: false, sourceId: null };
    for (const src of corpus) {
      if (src.numbers.has(digits)) return { grounded: true, sourceId: src.id };
    }
    return { grounded: false, sourceId: null };
  }

  if (cat === "date") return groundDate(ref.span, corpus);

  // money | number — exact canonical-token match (no substring grounding).
  const token = normalizeNumericToken(ref.span);
  if (!token) return { grounded: false, sourceId: null };
  for (const src of corpus) {
    if (src.numbers.has(token)) return { grounded: true, sourceId: src.id };
  }
  return { grounded: false, sourceId: null };
}
