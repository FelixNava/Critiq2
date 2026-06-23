/**
 * Transcript timeline (Phase 38d) — PURE: no DB, no network, no React. Turns the
 * per-segment Deepgram `words` (jsonb) into speaker-grouped LINES whose times are
 * re-based onto the single, concatenated audio timeline the 38c player serves, so
 * a line can seek the audio and the playing line can highlight.
 *
 * Word/evidence time re-basing is the locked contract §C
 * (docs/CALL_ANALYSIS_AUDIO_CONTRACT.md):
 *   - Deepgram word start/end are SECONDS, per-segment-relative.
 *   - OVERLAP (the 2s rotation redundancy) is trimmed at the START of every
 *     segment after the first.
 *   - offset_i = Σ_{j<i}(duration_j) − (i × OVERLAP)
 *   - word_global = max(0, word_local − (i>0 ? OVERLAP : 0)) + offset_i
 * For a SINGLE segment (every existing recording today) this collapses to
 * word_global = word_local — which is all 38d ships; the multi-segment branch is
 * built + unit-tested here but only wired once multi-segment audio is playable
 * (the device gate, contract §D).
 *
 * Speaker ids are bare diarization integers and are NOT stable across segments
 * (§C), so a line's `speakerKey` is scoped per (segment, speaker) for coloring;
 * callers must never carry speaker identity across a segment boundary, and never
 * label a speaker as the rep vs the buyer.
 */

import { OVERLAP_MS } from "./segmentedRecorder";

/** The rotation overlap in seconds — sourced from the recorder so it can't drift. */
export const SEGMENT_OVERLAP_SEC = OVERLAP_MS / 1000;

/** Soft cap: only break a long monologue into a new line at a sentence end past this length. */
const LINE_CHAR_SOFT_CAP = 160;
const SENTENCE_END = /[.?!]["')\]]?$/;

/** One transcript segment's playback-relevant fields (subset of transcript_segments). */
export interface TimelineSegmentInput {
  segmentIndex: number;
  /** Deepgram metadata.duration*1000 (overlap-INCLUSIVE); null on a failed/empty segment. */
  durationMs: number | null;
  /** The stored `words` jsonb (TranscriptWord[]). Coerced defensively. */
  words: unknown;
}

/** A clickable, time-anchored transcript line on the global audio timeline. */
export interface TranscriptLine {
  /** Global audio-time start (seconds) on the 38c concatenated timeline. */
  start: number;
  /** Global audio-time end (seconds). */
  end: number;
  /** Diarization speaker index within the segment, or null if undiarized. */
  speaker: number | null;
  segmentIndex: number;
  /** Per-(segment,speaker) key for stable coloring (ids aren't stable across segments). */
  speakerKey: string;
  text: string;
}

interface RawWord {
  display: string;
  start: number;
  end: number;
  speaker: number | null;
}

/** Defensively coerce the `words` jsonb to usable word tokens (skip malformed). */
function coerceWords(value: unknown): RawWord[] {
  if (!Array.isArray(value)) return [];
  const out: RawWord[] = [];
  for (const w of value) {
    if (!w || typeof w !== "object") continue;
    const o = w as Record<string, unknown>;
    const display =
      typeof o.punctuated_word === "string" && o.punctuated_word.length > 0
        ? o.punctuated_word
        : typeof o.word === "string"
          ? o.word
          : null;
    const start = typeof o.start === "number" ? o.start : null;
    const end = typeof o.end === "number" ? o.end : null;
    if (display && start != null && end != null && end >= start) {
      out.push({
        display,
        start,
        end,
        speaker: typeof o.speaker === "number" ? o.speaker : null,
      });
    }
  }
  return out;
}

/**
 * Build the speaker-grouped, time-anchored lines for a recording's segments.
 * A new line starts on a speaker change, or at a sentence end once the line has
 * grown past the soft cap (so a long monologue is readable, not one wall of text).
 */
export function buildTranscriptTimeline(
  segments: TimelineSegmentInput[],
): TranscriptLine[] {
  const ordered = [...segments].sort((a, b) => a.segmentIndex - b.segmentIndex);
  const lines: TranscriptLine[] = [];
  let cumDurSec = 0; // Σ_{j<i}(duration_j)

  for (let i = 0; i < ordered.length; i++) {
    const seg = ordered[i];
    const offset = cumDurSec - i * SEGMENT_OVERLAP_SEC; // offset_i
    const trim = i > 0 ? SEGMENT_OVERLAP_SEC : 0;
    const toGlobal = (local: number) => Math.max(0, local - trim) + offset;

    let cur:
      | { speaker: number | null; parts: string[]; len: number; start: number; end: number }
      | null = null;

    const flush = () => {
      if (!cur) return;
      lines.push({
        start: cur.start,
        end: cur.end,
        speaker: cur.speaker,
        segmentIndex: seg.segmentIndex,
        speakerKey: `${seg.segmentIndex}:${cur.speaker ?? "x"}`,
        text: cur.parts.join(" "),
      });
      cur = null;
    };

    for (const w of coerceWords(seg.words)) {
      const startNew =
        !cur ||
        cur.speaker !== w.speaker ||
        (cur.len >= LINE_CHAR_SOFT_CAP &&
          SENTENCE_END.test(cur.parts[cur.parts.length - 1] ?? ""));
      if (startNew) {
        flush();
        cur = {
          speaker: w.speaker,
          parts: [w.display],
          len: w.display.length,
          start: toGlobal(w.start),
          end: toGlobal(w.end),
        };
      } else {
        cur!.parts.push(w.display);
        cur!.len += w.display.length + 1;
        cur!.end = toGlobal(w.end);
      }
    }
    flush();

    cumDurSec += (seg.durationMs ?? 0) / 1000;
  }

  return lines;
}

/**
 * Index of the line "active" at audio time `t` (seconds): the last line whose
 * start ≤ t. Returns -1 before the first line. Lines must be in start order
 * (buildTranscriptTimeline guarantees it). Binary search — cheap on every
 * timeupdate.
 */
export function activeLineIndex(lines: TranscriptLine[], t: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].start <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}
