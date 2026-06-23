/**
 * Audio playback plan (Phase 38c) — PURE: no DB, no network, no `@vercel/blob`.
 * Turns a recording's chunk-row metadata into a single seekable byte timeline +
 * resolves HTTP Range requests against it. The route and the page both consume
 * this; keeping it pure makes the whole HTTP contract unit-testable
 * (scripts/verify-phase38c.ts) without a live Blob store.
 *
 * Locked design (docs/CALL_ANALYSIS_AUDIO_CONTRACT.md):
 *   - Blob is PRIVATE → bytes are always proxied server-side; we only deal in
 *     metadata + byte offsets here, never blob_url-to-browser.
 *   - A single capture SEGMENT is one continuous MediaRecorder stream sliced into
 *     5s chunks: concatenating its chunks in chunk_index order reproduces a valid
 *     playable file. So `ready` requires ONE segment (segment_index all 0) with a
 *     DENSE uploaded chunk_index sequence from 0.
 *   - MULTI-segment assembly (the 2s rotation overlap + a fresh container header
 *     per segment) is unresolved pending the iPhone device gate (contract §D1) →
 *     we degrade honestly to `multisegment`, never a corrupt naive concat.
 *   - A non-dense / partly-unuploaded sequence ⇒ `incomplete`, never a broken
 *     stream.
 */

/** A chunk row's playback-relevant metadata (subset of recording_chunks). */
export type AudioChunkRef = {
  chunkIndex: number;
  segmentIndex: number;
  blobUrl: string;
  blobPathname: string;
  sizeBytes: number;
  status: string; // pending | uploaded | failed
};

export type AudioPlanStatus =
  | "ready" // single dense uploaded segment → one playable timeline
  | "multisegment" // >1 segment → assembly deferred to the device gate
  | "incomplete" // chunks missing / non-dense / not all uploaded
  | "empty"; // no uploaded audio stored

/** One chunk's place on the concatenated byte timeline; `end` is EXCLUSIVE. */
export type AudioPlanPart = {
  chunkIndex: number;
  blobUrl: string;
  blobPathname: string;
  start: number;
  end: number;
};

export type AudioPlan = {
  status: AudioPlanStatus;
  /** Total bytes of the concatenated timeline (0 unless `ready`). */
  totalBytes: number;
  /** Content-Type to serve, inferred from the chunk pathname. */
  contentType: string;
  /** Contiguous parts in chunk order (empty unless `ready`). */
  parts: AudioPlanParts;
};

type AudioPlanParts = AudioPlanPart[];

const FALLBACK_CONTENT_TYPE = "application/octet-stream";

/**
 * Content-Type from the stored blob pathname's extension (recorder.ts writes
 * chunk-NNNNNN.<ext>). The store has no content_type column, and inferring from
 * the deterministic pathname avoids an extra Blob round-trip per request. A
 * server-proxy could also pass through the blob's own header; the extension is
 * authoritative here because we control how chunks are named.
 */
export function inferAudioContentType(blobPathname: string): string {
  const lower = blobPathname.toLowerCase();
  const ext = lower.slice(lower.lastIndexOf(".") + 1);
  switch (ext) {
    case "webm":
      return "audio/webm";
    case "mp4":
    case "m4a":
      return "audio/mp4";
    case "ogg":
      return "audio/ogg";
    case "wav":
      return "audio/wav";
    default:
      return FALLBACK_CONTENT_TYPE;
  }
}

/**
 * Build the playback plan from a recording's chunk rows (any order, any status).
 * Deterministic + total — never throws; an unusable set degrades to a non-`ready`
 * status the caller renders honestly.
 */
export function buildAudioPlan(refs: AudioChunkRef[]): AudioPlan {
  const empty: AudioPlan = {
    status: "empty",
    totalBytes: 0,
    contentType: FALLBACK_CONTENT_TYPE,
    parts: [],
  };

  const uploaded = refs
    .filter((r) => r.status === "uploaded")
    .sort((a, b) => a.chunkIndex - b.chunkIndex);

  if (uploaded.length === 0) return empty;

  // Multi-segment assembly is deferred to the device gate (contract §D1): a naive
  // cross-segment concat would splice two container headers + the 2s overlap into
  // a corrupt stream. Degrade honestly rather than guess a strategy.
  const maxSegment = uploaded.reduce((m, r) => Math.max(m, r.segmentIndex), 0);
  if (maxSegment > 0) {
    return { ...empty, status: "multisegment" };
  }

  // The uploaded chunk_index sequence must be dense from 0 (0,1,2,…,n-1) and every
  // chunk must carry a positive byte size, or the offsets can't be trusted.
  for (let i = 0; i < uploaded.length; i++) {
    if (uploaded[i].chunkIndex !== i || uploaded[i].sizeBytes <= 0) {
      return { ...empty, status: "incomplete" };
    }
  }

  // Contiguous byte offsets across the concatenated timeline.
  const parts: AudioPlanParts = [];
  let offset = 0;
  for (const r of uploaded) {
    parts.push({
      chunkIndex: r.chunkIndex,
      blobUrl: r.blobUrl,
      blobPathname: r.blobPathname,
      start: offset,
      end: offset + r.sizeBytes,
    });
    offset += r.sizeBytes;
  }

  return {
    status: "ready",
    totalBytes: offset,
    contentType: inferAudioContentType(parts[0].blobPathname),
    parts,
  };
}

/** Outcome of resolving a `Range` header against a known total length. */
export type RangeResolution =
  | { kind: "full" } // no/blank/unparseable range → serve the whole body (200)
  | { kind: "partial"; start: number; end: number } // inclusive end (206)
  | { kind: "unsatisfiable" }; // start past EOF / empty suffix (416)

/**
 * Resolve a single HTTP byte range against `totalBytes`. Supports the forms a
 * media element actually sends:
 *   bytes=0-1        (the iOS metadata probe)   → partial 0..1
 *   bytes=500-       (open-ended)               → partial 500..total-1
 *   bytes=0-1023     (closed)                   → partial, end clamped to total-1
 *   bytes=-500       (suffix length)            → partial total-500..total-1
 * No multi-range support (media never needs it) — a comma-separated header serves
 * the FIRST range. A malformed header is treated as "no range" (full 200), which
 * is a lenient, spec-acceptable degrade.
 */
export function resolveRange(
  rangeHeader: string | null | undefined,
  totalBytes: number,
): RangeResolution {
  if (!rangeHeader) return { kind: "full" };

  const m = /^bytes=(.*)$/i.exec(rangeHeader.trim());
  if (!m) return { kind: "full" };

  // Only the first range of a (rare for media) multi-range request.
  const spec = m[1].split(",")[0]?.trim() ?? "";
  const dash = spec.indexOf("-");
  if (dash === -1) return { kind: "full" };

  const startStr = spec.slice(0, dash).trim();
  const endStr = spec.slice(dash + 1).trim();

  if (totalBytes <= 0) return { kind: "unsatisfiable" };

  // Suffix form: bytes=-N → the last N bytes.
  if (startStr === "") {
    if (endStr === "") return { kind: "full" }; // "bytes=-" is meaningless
    const suffix = Number(endStr);
    if (!Number.isInteger(suffix) || suffix <= 0) return { kind: "full" };
    const start = Math.max(0, totalBytes - suffix);
    return { kind: "partial", start, end: totalBytes - 1 };
  }

  const start = Number(startStr);
  if (!Number.isInteger(start) || start < 0) return { kind: "full" };
  if (start >= totalBytes) return { kind: "unsatisfiable" };

  // Open-ended (bytes=start-) runs to EOF.
  if (endStr === "") {
    return { kind: "partial", start, end: totalBytes - 1 };
  }

  const end = Number(endStr);
  if (!Number.isInteger(end) || end < start) return { kind: "full" };
  return { kind: "partial", start, end: Math.min(end, totalBytes - 1) };
}

/** A slice of one chunk to read, in LOCAL chunk byte coordinates (end exclusive). */
export type PartSlice = {
  blobUrl: string;
  /** Byte offset within the chunk to start reading (inclusive). */
  readStart: number;
  /** Byte offset within the chunk to stop reading (exclusive). */
  readEnd: number;
};

/**
 * Select the chunk slices covering the GLOBAL inclusive byte range [start, end],
 * so the route fetches ONLY the chunks a range overlaps (not the whole recording)
 * and slices the first/last to align. Pure; parts must be the contiguous
 * `AudioPlan.parts`.
 */
export function selectParts(
  parts: AudioPlanParts,
  start: number,
  end: number,
): PartSlice[] {
  const endExclusive = end + 1; // convert inclusive → exclusive for overlap math
  const slices: PartSlice[] = [];
  for (const p of parts) {
    if (p.end <= start || p.start >= endExclusive) continue; // no overlap
    const overlapStart = Math.max(start, p.start);
    const overlapEnd = Math.min(endExclusive, p.end);
    slices.push({
      blobUrl: p.blobUrl,
      readStart: overlapStart - p.start,
      readEnd: overlapEnd - p.start,
    });
  }
  return slices;
}
