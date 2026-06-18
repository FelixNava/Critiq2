/**
 * Transcription types (Phase 15 — Deepgram Nova-3).
 *
 * The orchestration in `transcribe.ts` is pure + dependency-injected: it takes a
 * `Transcriber` (the thing that turns audio bytes → text) and a `ChunkFetcher`
 * (the thing that reads a chunk's bytes from Blob), so it can be unit-tested with
 * fakes (no network, no Blob) — the actual Deepgram round-trip is the runtime
 * gate Felix verifies on the preview. Multi-segment = Option B (locked memory
 * architecture): transcribe each ~10-min segment in parallel, then concatenate
 * the segment transcripts in segment order into one unified transcript.
 */

/** A word-level token from Deepgram (timing in seconds; speaker = diarization). */
export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
  /** Punctuated/cased form when smart_format is on. */
  punctuated_word?: string;
  /** Diarization speaker index (0,1,…) when diarize is on. */
  speaker?: number;
}

/** What a Transcriber returns for one audio blob. */
export interface TranscriptionOutput {
  text: string;
  words: TranscriptWord[];
  /** 0–1 average confidence for this audio. */
  confidence: number;
  /** Detected language (e.g. "en"), when the provider reports it. */
  language?: string;
  /** Audio duration in seconds, when the provider reports it. */
  durationSec?: number;
}

/**
 * Turns audio bytes into text. The real implementation calls Deepgram; tests
 * pass a fake. `contentType` is the audio container/codec (e.g.
 * "audio/webm;codecs=opus") forwarded from the stored Blob so the provider can
 * decode it.
 */
export interface Transcriber {
  transcribe(
    audio: Uint8Array,
    contentType: string,
  ): Promise<TranscriptionOutput>;
}

/** Reads a single chunk's bytes (+ its stored content type) from Blob. */
export interface ChunkFetcher {
  fetchChunk(blobUrl: string): Promise<{ bytes: Uint8Array; contentType: string }>;
}

/** A chunk reference the orchestrator groups into segments. */
export interface ChunkRef {
  chunkIndex: number;
  segmentIndex: number;
  blobUrl: string;
  durationMs?: number | null;
}

/** The transcript of a single ~10-min segment. */
export interface SegmentResult {
  segmentIndex: number;
  text: string;
  words: TranscriptWord[];
  confidence: number;
  durationMs: number | null;
  chunkCount: number;
  /** Detected language for this segment, when the provider reports it. */
  language?: string;
  /** Set when this segment failed; the others may still succeed. */
  error?: string;
}

/** The full result the orchestrator returns for a recording. */
export interface TranscriptionResult {
  /** Segment transcripts concatenated in segment order. */
  text: string;
  segments: SegmentResult[];
  wordCount: number;
  durationMs: number | null;
  segmentCount: number;
  language?: string;
  /** True when at least one segment failed (partial transcript). */
  partial: boolean;
}
