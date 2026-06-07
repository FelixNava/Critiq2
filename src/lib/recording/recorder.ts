/**
 * Recording Infrastructure — Layer 4: chunked audio capture.
 *
 * A thin wrapper over getUserMedia(audio) + MediaRecorder that emits a stream of
 * Blob chunks on a fixed timeslice (~5s). It feature-detects the best supported
 * container/codec (webm/opus on Chrome/Android, mp4/aac on Safari) and degrades
 * to the browser default. This module captures ONLY — persistence + upload live
 * in chunkStore/uploader, and the session keep-alive (Layers 1-3) is owned by the
 * caller, which starts it on record-start and stops it on record-stop.
 *
 * Single continuous segment for now (5s chunks). Rotation/overlap + tiered
 * recovery are a later recording phase; this layer just produces chunks and
 * reports status honestly.
 */

export type RecorderStatus =
  | "idle"
  | "requesting" // awaiting the getUserMedia permission prompt
  | "recording"
  | "stopped"
  | "unsupported"
  | "error";

export interface RecorderChunk {
  index: number;
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

export interface RecorderCallbacks {
  onChunk: (chunk: RecorderChunk) => void;
  onStatus?: (status: RecorderStatus) => void;
  onError?: (err: unknown) => void;
}

export class AudioRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private status: RecorderStatus = "idle";
  private chunkIndex = 0;
  private mimeType = "";
  private readonly timesliceMs: number;
  private readonly callbacks: RecorderCallbacks;

  constructor(callbacks: RecorderCallbacks, timesliceMs = DEFAULT_TIMESLICE_MS) {
    this.callbacks = callbacks;
    this.timesliceMs = timesliceMs;
    if (!isRecordingSupported()) this.setStatus("unsupported");
  }

  getStatus(): RecorderStatus {
    return this.status;
  }

  getMimeType(): string {
    return this.mimeType;
  }

  private setStatus(status: RecorderStatus): void {
    this.status = status;
    this.callbacks.onStatus?.(status);
  }

  async start(): Promise<void> {
    if (!isRecordingSupported()) {
      this.setStatus("unsupported");
      return;
    }
    if (this.recorder) return; // already capturing

    this.setStatus("requesting");
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      // Permission denied / no device — terminal for this attempt.
      this.setStatus("error");
      this.callbacks.onError?.(err);
      return;
    }

    this.mimeType = pickMimeType();
    try {
      this.recorder = this.mimeType
        ? new MediaRecorder(this.stream, { mimeType: this.mimeType })
        : new MediaRecorder(this.stream);
    } catch {
      // The picked type was rejected by the constructor despite isTypeSupported.
      try {
        this.recorder = new MediaRecorder(this.stream);
        this.mimeType = this.recorder.mimeType || "";
      } catch (err2) {
        this.setStatus("error");
        this.callbacks.onError?.(err2);
        this.teardownStream();
        return;
      }
    }

    this.chunkIndex = 0;
    this.recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) {
        this.callbacks.onChunk({
          index: this.chunkIndex++,
          blob: e.data,
          mimeType: this.mimeType || e.data.type || "application/octet-stream",
        });
      }
    };
    this.recorder.onerror = (e: Event) => {
      this.setStatus("error");
      this.callbacks.onError?.(
        (e as unknown as { error?: unknown }).error ?? e,
      );
    };
    try {
      this.recorder.start(this.timesliceMs);
    } catch (err) {
      // start() can throw (e.g. invalid state) — release the mic, don't leak it.
      this.setStatus("error");
      this.callbacks.onError?.(err);
      this.teardownStream();
      this.recorder = null;
      return;
    }
    this.setStatus("recording");
  }

  async stop(): Promise<void> {
    const rec = this.recorder;
    if (rec && rec.state !== "inactive") {
      // stop() flushes one final ondataavailable then fires "stop" — wait for it
      // so the caller can upload the tail chunk before tearing the stream down.
      // Guard with a timeout so a missing "stop" event (rare engine quirk) can't
      // wedge the caller forever.
      const flushed = new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        rec.addEventListener("stop", done, { once: true });
        setTimeout(done, 2000);
      });
      try {
        rec.stop();
      } catch {
        // already stopped — ignore.
      }
      await flushed;
    }
    this.teardownStream();
    this.recorder = null;
    if (this.status !== "unsupported" && this.status !== "error") {
      this.setStatus("stopped");
    }
  }

  private teardownStream(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        try {
          track.stop();
        } catch {
          // ignore
        }
      }
      this.stream = null;
    }
  }
}
