/**
 * Pure transcription orchestration (Phase 15) — no DB, no network, fully
 * dependency-injected so it unit-tests with fakes. Implements the locked
 * multi-segment Option B: group chunks into ~10-min capture segments, transcribe
 * each segment in parallel (bounded concurrency), then concatenate the segment
 * transcripts in segment order into one unified transcript.
 *
 * A segment is one rotating MediaRecorder's output (Phase 13), so its chunks —
 * in chunkIndex order — concatenate into a single self-contained, decodable audio
 * file (only segment 0's first chunk carries the container header; each segment
 * is its own recorder). That concatenated buffer is what we hand the Transcriber.
 *
 * Overlap note: Phase 13 starts each new segment ~2s before the previous stops
 * (zero audio gap). At the text level that means ~2s of duplicated words at a
 * seam. For beta we keep the simple ordered concatenation (a small, visible
 * duplication beats silently dropping real words); transcript-level overlap
 * dedupe using the word timestamps is a documented future refinement.
 */

import type {
  ChunkFetcher,
  ChunkRef,
  SegmentResult,
  Transcriber,
  TranscriptionResult,
  TranscriptWord,
} from "./types";

export interface TranscribeRecordingDeps {
  transcriber: Transcriber;
  fetchChunk: ChunkFetcher["fetchChunk"];
  /** Max segments transcribed at once (Deepgram-friendly). Default 3. */
  concurrency?: number;
  /** Called as each segment finishes (success or fail) — lets the caller
   *  persist per-segment results incrementally. */
  onSegment?: (segment: SegmentResult) => Promise<void> | void;
}

/** Group chunks into segments, each sorted by chunkIndex. Sorted by segmentIndex. */
export function groupChunksBySegment(chunks: ChunkRef[]): Map<number, ChunkRef[]> {
  const bySegment = new Map<number, ChunkRef[]>();
  for (const c of chunks) {
    const list = bySegment.get(c.segmentIndex);
    if (list) list.push(c);
    else bySegment.set(c.segmentIndex, [c]);
  }
  for (const list of bySegment.values()) {
    list.sort((a, b) => a.chunkIndex - b.chunkIndex);
  }
  return new Map([...bySegment.entries()].sort((a, b) => a[0] - b[0]));
}

/** Concatenate byte arrays into one contiguous Uint8Array. */
export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Run async tasks with a bounded concurrency, preserving input order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = new Array(Math.max(1, Math.min(limit, items.length)))
    .fill(0)
    .map(async () => {
      while (true) {
        const i = cursor++;
        if (i >= items.length) return;
        results[i] = await fn(items[i], i);
      }
    });
  await Promise.all(workers);
  return results;
}

async function transcribeSegment(
  segmentIndex: number,
  chunks: ChunkRef[],
  deps: TranscribeRecordingDeps,
): Promise<SegmentResult> {
  const durationMs = chunks.reduce(
    (n, c) => n + (typeof c.durationMs === "number" ? c.durationMs : 0),
    0,
  );
  try {
    const fetched = await Promise.all(
      chunks.map((c) => deps.fetchChunk(c.blobUrl)),
    );
    const bytes = concatBytes(fetched.map((f) => f.bytes));
    const contentType = fetched[0]?.contentType || "audio/webm";
    if (bytes.length === 0) {
      return {
        segmentIndex,
        text: "",
        words: [],
        confidence: 0,
        durationMs: durationMs || null,
        chunkCount: chunks.length,
      };
    }
    const out = await deps.transcriber.transcribe(bytes, contentType);
    return {
      segmentIndex,
      text: out.text,
      words: out.words,
      confidence: out.confidence,
      durationMs:
        durationMs ||
        (typeof out.durationSec === "number"
          ? Math.round(out.durationSec * 1000)
          : null),
      chunkCount: chunks.length,
      ...(out.language ? { language: out.language } : {}),
    };
  } catch (e) {
    return {
      segmentIndex,
      text: "",
      words: [],
      confidence: 0,
      durationMs: durationMs || null,
      chunkCount: chunks.length,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Transcribe a whole recording from its chunk list. Segments run in parallel
 * (bounded); a segment that throws is captured as a failed SegmentResult so the
 * rest still produce a (partial) transcript rather than losing everything.
 */
export async function transcribeRecording(
  chunks: ChunkRef[],
  deps: TranscribeRecordingDeps,
): Promise<TranscriptionResult> {
  const grouped = groupChunksBySegment(chunks);
  const entries = [...grouped.entries()]; // already sorted by segmentIndex
  const concurrency = deps.concurrency ?? 3;

  const segments = await mapWithConcurrency(
    entries,
    concurrency,
    async ([segmentIndex, segChunks]) => {
      const result = await transcribeSegment(segmentIndex, segChunks, deps);
      if (deps.onSegment) await deps.onSegment(result);
      return result;
    },
  );

  // Already in segment order (entries were sorted); concat the non-empty texts.
  const text = segments
    .map((s) => s.text)
    .filter((t) => t.length > 0)
    .join("\n");
  const wordCount = segments.reduce(
    (n, s) => n + countWords(s.words, s.text),
    0,
  );
  const durationMs = segments.reduce(
    (n, s) => n + (s.durationMs ?? 0),
    0,
  );
  const language = segments.find((s) => s.language)?.language;
  const partial = segments.some((s) => s.error);

  return {
    text,
    segments,
    wordCount,
    durationMs: durationMs || null,
    segmentCount: segments.length,
    ...(language ? { language } : {}),
    partial,
  };
}

/** Word count = Deepgram words when present, else whitespace tokens of the text. */
function countWords(words: TranscriptWord[], text: string): number {
  if (words.length > 0) return words.length;
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}
