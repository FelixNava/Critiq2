/**
 * Phase 38c unit verification — the audio playback plan + HTTP Range contract.
 * PURE: no DB, no network, no Blob. Imports the REAL app module (no
 * re-implementation, per the standing rule) and exercises every branch of the
 * locked contract (docs/CALL_ANALYSIS_AUDIO_CONTRACT.md):
 *   - buildAudioPlan: ready / multisegment / incomplete / empty classification +
 *     contiguous byte offsets + Content-Type inference.
 *   - resolveRange: the iOS bytes=0-1 probe, open-ended, suffix, clamp,
 *     unsatisfiable (416), and lenient full-fallback on malformed headers.
 *   - selectParts: only the chunks a range overlaps, sliced to local coordinates.
 *
 * The byte-streaming path (authenticated private Blob reads) is exercised by a
 * throwaway real-Blob probe on the preview, mirroring the Phase 38f posture.
 *
 * Run: pnpm tsx scripts/verify-phase38c.ts
 */
import {
  buildAudioPlan,
  resolveRange,
  selectParts,
  inferAudioContentType,
  type AudioChunkRef,
} from "../src/lib/recording/audioPlan";

const fails: string[] = [];
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) fails.push(msg);
};
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(JSON.stringify(a) === JSON.stringify(b), msg);

/** Concise chunk-ref builder. */
function ref(
  chunkIndex: number,
  sizeBytes: number,
  opts: Partial<AudioChunkRef> = {},
): AudioChunkRef {
  return {
    chunkIndex,
    segmentIndex: opts.segmentIndex ?? 0,
    blobUrl:
      opts.blobUrl ??
      `https://x.blob.vercel-storage.com/recordings/r/chunk-${String(
        chunkIndex,
      ).padStart(6, "0")}.webm`,
    blobPathname:
      opts.blobPathname ?? `recordings/r/chunk-${chunkIndex}.webm`,
    sizeBytes,
    status: opts.status ?? "uploaded",
  };
}

// ---------------------------------------------------------------------------
console.log("\n## inferAudioContentType");
// ---------------------------------------------------------------------------
ok(inferAudioContentType("recordings/r/chunk-0.webm") === "audio/webm", "webm → audio/webm");
ok(inferAudioContentType("recordings/r/chunk-0.mp4") === "audio/mp4", "mp4 → audio/mp4 (iOS)");
ok(inferAudioContentType("recordings/r/chunk-0.m4a") === "audio/mp4", "m4a → audio/mp4");
ok(inferAudioContentType("recordings/r/chunk-0.ogg") === "audio/ogg", "ogg → audio/ogg");
ok(inferAudioContentType("recordings/r/chunk-0.wav") === "audio/wav", "wav → audio/wav");
ok(inferAudioContentType("recordings/r/CHUNK-0.WEBM") === "audio/webm", "extension is case-insensitive");
ok(inferAudioContentType("recordings/r/chunk-0.bin") === "application/octet-stream", "unknown ext → octet-stream");

// ---------------------------------------------------------------------------
console.log("\n## buildAudioPlan — classification");
// ---------------------------------------------------------------------------
ok(buildAudioPlan([]).status === "empty", "no chunks → empty");
ok(
  buildAudioPlan([ref(0, 100, { status: "pending" }), ref(1, 100, { status: "failed" })]).status === "empty",
  "no uploaded chunks → empty",
);

const ready = buildAudioPlan([ref(2, 300), ref(0, 100), ref(1, 200)]); // out of order
ok(ready.status === "ready", "dense single-segment uploaded set → ready (sorts input)");
ok(ready.totalBytes === 600, "ready totalBytes = Σ sizeBytes");
ok(ready.contentType === "audio/webm", "ready contentType inferred from first chunk pathname");
eq(
  ready.parts.map((p) => [p.chunkIndex, p.start, p.end]),
  [
    [0, 0, 100],
    [1, 100, 300],
    [2, 300, 600],
  ],
  "ready parts have contiguous [start,end) byte offsets in chunk order",
);

ok(
  buildAudioPlan([ref(0, 100), ref(1, 100, { segmentIndex: 1 })]).status === "multisegment",
  "a second segment → multisegment (assembly deferred to the device gate)",
);
ok(
  buildAudioPlan([ref(0, 100), ref(2, 100)]).status === "incomplete",
  "a hole in the chunk_index sequence → incomplete",
);
ok(
  buildAudioPlan([ref(1, 100), ref(2, 100)]).status === "incomplete",
  "sequence not starting at 0 → incomplete",
);
ok(
  buildAudioPlan([ref(0, 100), ref(1, 100, { status: "failed" }), ref(2, 100)]).status === "incomplete",
  "uploaded {0,2} with a failed 1 → non-dense → incomplete (no corrupt stream)",
);
ok(
  buildAudioPlan([ref(0, 100), ref(1, 0)]).status === "incomplete",
  "a zero-byte chunk → incomplete (offsets untrustworthy)",
);
const prefix = buildAudioPlan([ref(0, 100), ref(1, 200), ref(2, 50, { status: "pending" })]);
ok(prefix.status === "ready" && prefix.totalBytes === 300, "a still-pending tail chunk is ignored; the complete prefix {0,1} is ready");

// ---------------------------------------------------------------------------
console.log("\n## resolveRange (total = 600)");
// ---------------------------------------------------------------------------
const T = 600;
eq(resolveRange(null, T), { kind: "full" }, "no Range header → full (200)");
eq(resolveRange("", T), { kind: "full" }, "blank Range → full");
eq(resolveRange("bytes=0-1", T), { kind: "partial", start: 0, end: 1 }, "bytes=0-1 (iOS probe) → partial 0..1");
eq(resolveRange("bytes=0-", T), { kind: "partial", start: 0, end: 599 }, "bytes=0- (open-ended) → 0..EOF");
eq(resolveRange("bytes=100-199", T), { kind: "partial", start: 100, end: 199 }, "closed range honored");
eq(resolveRange("bytes=500-", T), { kind: "partial", start: 500, end: 599 }, "bytes=500- → 500..EOF");
eq(resolveRange("bytes=-100", T), { kind: "partial", start: 500, end: 599 }, "suffix bytes=-100 → last 100 bytes");
eq(resolveRange("bytes=590-9999", T), { kind: "partial", start: 590, end: 599 }, "end past EOF is clamped");
eq(resolveRange("bytes=600-", T), { kind: "unsatisfiable" }, "start == total → 416");
eq(resolveRange("bytes=700-800", T), { kind: "unsatisfiable" }, "start past EOF → 416");
eq(resolveRange("bytes=0-1", 0), { kind: "unsatisfiable" }, "any range on an empty body → 416");
eq(resolveRange("bytes=-0", T), { kind: "full" }, "suffix 0 is meaningless → full");
eq(resolveRange("bytes=abc", T), { kind: "full" }, "non-numeric → lenient full");
eq(resolveRange("bytes=50-20", T), { kind: "full" }, "end < start → lenient full");
eq(resolveRange("items=0-1", T), { kind: "full" }, "non-bytes unit → full");
eq(resolveRange("bytes=100-199,300-399", T), { kind: "partial", start: 100, end: 199 }, "multi-range → first range only");

// ---------------------------------------------------------------------------
console.log("\n## selectParts (parts: [0,100) [100,300) [300,600))");
// ---------------------------------------------------------------------------
const parts = buildAudioPlan([ref(0, 100), ref(1, 200), ref(2, 300)]).parts;
const sl = (s: number, e: number) =>
  selectParts(parts, s, e).map((x) => [x.blobUrl.includes("000000") ? 0 : x.blobUrl.includes("000001") ? 1 : 2, x.readStart, x.readEnd]);

eq(sl(0, 1), [[0, 0, 2]], "range 0..1 reads only chunk 0, local 0..2");
eq(sl(0, 599), [[0, 0, 100], [1, 0, 200], [2, 0, 300]], "full range reads all chunks, each fully");
eq(sl(150, 350), [[1, 50, 200], [2, 0, 51]], "cross-chunk range slices the first + last chunk to local coords");
eq(sl(100, 100), [[1, 0, 1]], "a single byte at a chunk boundary reads 1 byte of chunk 1");
eq(sl(10, 20), [[0, 10, 21]], "a range fully inside one chunk reads only that chunk");

// total bytes of a selection equals the requested length
const sel = selectParts(parts, 150, 350);
const selBytes = sel.reduce((n, s) => n + (s.readEnd - s.readStart), 0);
ok(selBytes === 350 - 150 + 1, "selected slice bytes == requested inclusive range length");

// ---------------------------------------------------------------------------
console.log(`\n${fails.length === 0 ? "PASS" : "FAIL"} — ${fails.length} failing`);
if (fails.length > 0) {
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
