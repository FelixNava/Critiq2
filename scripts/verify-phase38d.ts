/**
 * Phase 38d unit verification — the transcript timeline mapper. PURE: no DB, no
 * network, no React. Imports the REAL module (no re-implementation) and proves:
 *   - §C global-time re-basing matches the contract's WORKED EXAMPLE exactly
 *     (offset_1 = 598, a word at local 10s in seg1 → 606.0s, local 5s in seg2 →
 *     1199.0s), incl. the overlap-region clamp to the seam.
 *   - Single-segment = identity (word_global == word_local) — all 38d ships.
 *   - Speaker grouping (split on speaker change; per-(segment,speaker) color key),
 *     the sentence-aware soft-cap line break, punctuated_word display, and
 *     defensive coercion of malformed/null `words`.
 *   - activeLineIndex binary search.
 *
 * Run: pnpm tsx scripts/verify-phase38d.ts
 */
import {
  buildTranscriptTimeline,
  activeLineIndex,
  SEGMENT_OVERLAP_SEC,
  type TimelineSegmentInput,
} from "../src/lib/recording/transcriptTimeline";

const fails: string[] = [];
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) fails.push(msg);
};
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(JSON.stringify(a) === JSON.stringify(b), msg);

const w = (word: string, start: number, end: number, speaker?: number) => ({
  word,
  start,
  end,
  ...(speaker === undefined ? {} : { speaker }),
});

// ---------------------------------------------------------------------------
console.log("\n## overlap constant + single-segment identity");
// ---------------------------------------------------------------------------
ok(SEGMENT_OVERLAP_SEC === 2, "SEGMENT_OVERLAP_SEC = 2 (sourced from recorder OVERLAP_MS)");

const single: TimelineSegmentInput[] = [
  { segmentIndex: 0, durationMs: 60000, words: [w("Hi", 0, 0.5, 0), w("there.", 0.5, 1, 0), w("Yes", 2, 2.5, 1)] },
];
const sLines = buildTranscriptTimeline(single);
ok(sLines.length === 2, "single segment groups into 2 lines on the speaker change");
eq([sLines[0].start, sLines[0].end, sLines[0].text, sLines[0].speakerKey], [0, 1, "Hi there.", "0:0"], "line 1 = speaker 0, global == local (offset 0)");
eq([sLines[1].start, sLines[1].text, sLines[1].speakerKey], [2, "Yes", "0:1"], "line 2 = speaker 1, key scoped to the segment");

// ---------------------------------------------------------------------------
console.log("\n## multi-segment re-basing — the contract's worked example");
// ---------------------------------------------------------------------------
// seg0 dur=600s, seg1 dur=600s, seg2 dur=300s; OVERLAP=2 → offset_1=598, offset_2=1196.
const multi: TimelineSegmentInput[] = [
  { segmentIndex: 0, durationMs: 600000, words: [w("Start", 0, 1, 0)] },
  { segmentIndex: 1, durationMs: 600000, words: [w("Mid", 10, 11, 0)] },
  { segmentIndex: 2, durationMs: 300000, words: [w("Late", 5, 6, 0)] },
];
const mLines = buildTranscriptTimeline(multi);
const seg1Mid = mLines.find((l) => l.segmentIndex === 1);
const seg2Late = mLines.find((l) => l.segmentIndex === 2);
ok(seg1Mid?.start === 606, "seg1 word at local 10s → global 606.0s (max(0,10−2)+598)");
ok(seg2Late?.start === 1199, "seg2 word at local 5s → global 1199.0s (max(0,5−2)+1196)");
// A word inside the 2s overlap region (local < OVERLAP) clamps to the seam.
const seam = buildTranscriptTimeline([
  { segmentIndex: 0, durationMs: 600000, words: [w("x", 0, 1, 0)] },
  { segmentIndex: 1, durationMs: 600000, words: [w("seamword", 1, 1.5, 0)] },
]);
ok(seam.find((l) => l.segmentIndex === 1)?.start === 598, "a word inside the overlap region clamps to the seam (offset_1 = 598)");

// ---------------------------------------------------------------------------
console.log("\n## speaker keys not carried across a segment boundary");
// ---------------------------------------------------------------------------
const cross: TimelineSegmentInput[] = [
  { segmentIndex: 0, durationMs: 600000, words: [w("a", 0, 1, 0)] },
  { segmentIndex: 1, durationMs: 600000, words: [w("b", 5, 6, 0)] },
];
const cLines = buildTranscriptTimeline(cross);
ok(cLines[0].speakerKey === "0:0" && cLines[1].speakerKey === "1:0", "same diarization id 0 in two segments → distinct color keys (0:0 vs 1:0)");

// ---------------------------------------------------------------------------
console.log("\n## sentence-aware soft-cap line break + punctuated display");
// ---------------------------------------------------------------------------
// One sentence end ("boundary.") lands past the 160-char soft cap → exactly one break.
const longWords = Array.from({ length: 50 }, (_, i) => w(i === 30 ? "boundary." : `word${i}`, i, i + 0.5, 0));
const longLines = buildTranscriptTimeline([{ segmentIndex: 0, durationMs: 60000, words: longWords }]);
ok(longLines.length === 2, "a long single-speaker run breaks at a sentence end past the soft cap");
ok(longLines[0].text.endsWith("boundary."), "the break lands AT the sentence boundary, not mid-sentence");

const punct = buildTranscriptTimeline([{ segmentIndex: 0, durationMs: 1000, words: [{ word: "hello", punctuated_word: "Hello,", start: 0, end: 1, speaker: 0 }] }]);
ok(punct[0].text === "Hello,", "punctuated_word is preferred for display");

// ---------------------------------------------------------------------------
console.log("\n## defensive coercion");
// ---------------------------------------------------------------------------
ok(buildTranscriptTimeline([{ segmentIndex: 0, durationMs: null, words: null }]).length === 0, "null words → no lines (failed segment)");
ok(buildTranscriptTimeline([{ segmentIndex: 0, durationMs: 1000, words: "garbage" }]).length === 0, "non-array words → no lines");
const messy = buildTranscriptTimeline([{ segmentIndex: 0, durationMs: 1000, words: [w("ok", 0, 1, 0), { word: "noStart", end: 2 }, { start: 3, end: 4 }, null] }]);
ok(messy.length === 1 && messy[0].text === "ok", "malformed words (missing start / missing word / null) are skipped");
const undiar = buildTranscriptTimeline([{ segmentIndex: 0, durationMs: 1000, words: [w("x", 0, 1)] }]);
ok(undiar[0].speaker === null && undiar[0].speakerKey === "0:x", "undiarized word → speaker null, key …:x");

// segments out of order are sorted before offset accumulation
const reordered = buildTranscriptTimeline([
  { segmentIndex: 1, durationMs: 600000, words: [w("second", 10, 11, 0)] },
  { segmentIndex: 0, durationMs: 600000, words: [w("first", 0, 1, 0)] },
]);
ok(reordered[0].text === "first" && reordered[1].start === 606, "out-of-order segments are sorted (offset still 598)");

// ---------------------------------------------------------------------------
console.log("\n## activeLineIndex");
// ---------------------------------------------------------------------------
const lines = buildTranscriptTimeline([{ segmentIndex: 0, durationMs: 60000, words: [w("a", 0, 1, 0), w("b", 5, 6, 1), w("c", 10, 11, 0)] }]);
ok(activeLineIndex(lines, -1) === -1, "before the first line → -1");
ok(activeLineIndex(lines, 0) === 0, "at a line start → that line");
ok(activeLineIndex(lines, 4.9) === 0, "between lines → the most recent line");
ok(activeLineIndex(lines, 5) === 1, "at the next line start → advances");
ok(activeLineIndex(lines, 999) === 2, "past the last line → the last line");

// ---------------------------------------------------------------------------
console.log(`\n${fails.length === 0 ? "PASS" : "FAIL"} — ${fails.length} failing`);
if (fails.length > 0) {
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
