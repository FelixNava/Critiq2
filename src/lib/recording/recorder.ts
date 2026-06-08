/**
 * Recording Infrastructure — Layer 4 capture primitives (shared).
 *
 * Feature detection, MIME selection, and the chunk/extension helpers shared by
 * the recorder + uploader. The single-segment capture loop that used to live
 * here (AudioRecorder) is superseded by `SegmentedRecorder` (segmentedRecorder.ts),
 * which adds 10-min segment rotation with a 2s overlap, a 5s heartbeat, and
 * tiered failure recovery (Phase 13). These helpers stay shared between them.
 */

export interface RecorderChunk {
  /** Monotonic index across the WHOLE recording (every segment). */
  index: number;
  /** Which ~10-min segment this chunk belongs to (0-based). */
  segmentIndex: number;
  blob: Blob;
  mimeType: string;
}

// Preference order: Opus in WebM (Chrome/Android, best), then Safari's mp4/aac,
// then looser fallbacks. The first MediaRecorder-supported type wins; "" lets the
// browser choose its own default.
const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

export const DEFAULT_TIMESLICE_MS = 5000;

export function isRecordingSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function" &&
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined"
  );
}

/** First MediaRecorder-supported MIME type, or "" to let the browser default. */
export function pickMimeType(): string {
  if (
    typeof window === "undefined" ||
    typeof window.MediaRecorder === "undefined"
  ) {
    return "";
  }
  for (const type of PREFERRED_MIME_TYPES) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type;
    } catch {
      // isTypeSupported can throw on some engines — treat as unsupported.
    }
  }
  return "";
}

/** File extension for a MIME type, used to name the blob pathname. */
export function extensionForMimeType(mimeType: string): string {
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("wav")) return "wav";
  return "bin";
}
