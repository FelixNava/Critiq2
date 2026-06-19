/**
 * Phase 35a/b unit verification — Add Context + Import past calls. Pure: no DB, no
 * network. Imports the REAL app modules (no re-implementation, per the standing rule):
 * the context normalizer (35a) and the import normalizer (35b). The DB-backed pieces
 * (rep/account context get/set, the grounding-corpus inclusion, the import→structured
 * debrief→consolidation path) are exercised by a throwaway real-Postgres probe (not
 * committed). This proves the pure trim/clamp/validation policy across all branches.
 *
 * Run: pnpm tsx scripts/verify-phase35.ts
 */
import {
  MAX_REP_CONTEXT,
  MAX_ACCOUNT_CONTEXT,
  normalizeContext,
} from "../src/lib/context";
import {
  IMPORT_MAX_CHARS,
  IMPORT_MIN_CHARS,
  normalizeImport,
} from "../src/lib/debrief/import";
import { MAX_FIELD } from "../src/lib/debrief/reporter";

const fails: string[] = [];
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) fails.push(msg);
};

// ---------------------------------------------------------------------------
console.log("\n## normalizeContext (35a — rep + account free-text)");
// ---------------------------------------------------------------------------
ok(normalizeContext("  hello  ", MAX_REP_CONTEXT) === "hello", "trims surrounding whitespace");
ok(normalizeContext("", MAX_REP_CONTEXT) === null, "empty string → null (clear)");
ok(normalizeContext("   \n\t  ", MAX_REP_CONTEXT) === null, "all-whitespace → null (clear)");
ok(normalizeContext(null, MAX_REP_CONTEXT) === null, "null → null");
ok(normalizeContext(undefined, MAX_REP_CONTEXT) === null, "undefined → null");
ok(normalizeContext(42, MAX_REP_CONTEXT) === null, "non-string → null");
ok(normalizeContext({ a: 1 }, MAX_REP_CONTEXT) === null, "object → null");

const longRep = "a".repeat(MAX_REP_CONTEXT + 500);
const clampedRep = normalizeContext(longRep, MAX_REP_CONTEXT);
ok(clampedRep != null && clampedRep.length === MAX_REP_CONTEXT, "rep context clamps to MAX_REP_CONTEXT");

const longAcct = "b".repeat(MAX_ACCOUNT_CONTEXT + 500);
const clampedAcct = normalizeContext(longAcct, MAX_ACCOUNT_CONTEXT);
ok(clampedAcct != null && clampedAcct.length === MAX_ACCOUNT_CONTEXT, "account context clamps to MAX_ACCOUNT_CONTEXT");

ok(MAX_REP_CONTEXT > 0 && MAX_ACCOUNT_CONTEXT > 0, "context caps are positive");

// A value that's whitespace-padded but has content survives, trimmed + clamped.
const mixed = "  " + "c".repeat(MAX_REP_CONTEXT + 10) + "  ";
const mixedOut = normalizeContext(mixed, MAX_REP_CONTEXT);
ok(mixedOut != null && mixedOut.length === MAX_REP_CONTEXT, "trims THEN clamps (no off-by-padding)");

// ---------------------------------------------------------------------------
console.log("\n## normalizeImport (35b — past-call import → DebriefReport)");
// ---------------------------------------------------------------------------
const tooShort = normalizeImport({ rawText: "hi" });
ok(!tooShort.ok, "rejects a too-short paste (< IMPORT_MIN_CHARS)");

const empty = normalizeImport({ rawText: "    " });
ok(!empty.ok, "rejects an all-whitespace paste");

const nonString = normalizeImport({ rawText: 123 });
ok(!nonString.ok, "rejects a non-string paste");

const validText = "We met with Dana at the warehouse and walked the floor.";
const valid = normalizeImport({ rawText: validText });
ok(valid.ok, "accepts a real paste");
ok(valid.ok && valid.report.happened === validText.trim(), "puts the paste in report.happened (trimmed)");
ok(valid.ok && valid.report.objective === undefined, "no `about` → no objective field");

const withAbout = normalizeImport({ rawText: validText, about: "  First walkthrough  " });
ok(withAbout.ok && withAbout.report.objective === "First walkthrough", "`about` → trimmed objective");

const longPaste = "z".repeat(IMPORT_MAX_CHARS + 1000);
const clampedPaste = normalizeImport({ rawText: longPaste });
ok(
  clampedPaste.ok && clampedPaste.report.happened.length === IMPORT_MAX_CHARS,
  "clamps an over-long paste to IMPORT_MAX_CHARS (doesn't reject)",
);

const longAbout = normalizeImport({ rawText: validText, about: "y".repeat(MAX_FIELD + 100) });
ok(
  longAbout.ok && longAbout.report.objective!.length === MAX_FIELD,
  "clamps a long `about` to MAX_FIELD",
);

ok(
  IMPORT_MAX_CHARS > MAX_REP_CONTEXT && IMPORT_MAX_CHARS >= 10000,
  "import cap is much larger than the live-debrief field (a transcript is verbatim)",
);
ok(IMPORT_MIN_CHARS > 0 && IMPORT_MIN_CHARS < IMPORT_MAX_CHARS, "import min/max bounds are sane");

// The import report is shaped EXACTLY like a live DebriefReport (so it flows through the
// same generator + consolidation with no special-casing) — only `happened` is required.
const shapeCheck = normalizeImport({ rawText: validText, about: "x" });
ok(
  shapeCheck.ok &&
    typeof shapeCheck.report.happened === "string" &&
    !("recordingId" in shapeCheck.report),
  "import yields a plain DebriefReport (happened [+objective]); no extra fields",
);

// ---------------------------------------------------------------------------
if (fails.length) {
  console.error(`\n✗ ${fails.length} check(s) failed:\n` + fails.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
console.log("\n✓ All Phase 35a/b unit checks passed.");
