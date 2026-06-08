/**
 * Recording Infrastructure — Layer 5: chunk upload + retry orchestration.
 *
 * Ties the local store (Layer 6) to remote durable storage (Vercel Blob). For
 * each chunk: persist to IndexedDB FIRST, then upload; on confirmed upload, evict
 * from IndexedDB; on failure, leave it in IndexedDB so it stays in the retry
 * queue. `flushPending` drains that queue and is called after a failure, on
 * `online`, and at stop() — making upload resilient to flaky field connectivity.
 *
 * The network step is injectable (`uploadFn`) so the retry/persist/evict logic
 * can be unit-tested against synthetic blobs with a fake network, without a
 * browser or a live Blob store. The production `blobUpload` does a presigned
 * client upload to Vercel Blob, then confirms server-side from the authenticated
 * session (we do NOT depend on Vercel's onUploadCompleted callback — it can't
 * reach an SSO-protected preview and never fires on localhost).
 */

import {
  saveChunk,
  confirmChunk,
  recordAttempt,
  listPendingChunks,
  pendingCount,
  type StoredChunk,
} from "./chunkStore";
import { extensionForMimeType } from "./recorder";

export interface UploadedBlobInfo {
  url: string;
  pathname: string;
}

/** Injectable network step: get this chunk durably stored remotely. */
export type ChunkUploadFn = (
  blob: Blob,
  pathname: string,
  ctx: { recordingId: string; chunkIndex: number; segmentIndex: number },
) => Promise<UploadedBlobInfo>;

export type ChunkUploadState = "pending" | "uploading" | "uploaded" | "failed";

export interface UploaderCallbacks {
  onChunkState?: (chunkIndex: number, state: ChunkUploadState) => void;
}

const HANDLE_UPLOAD_URL = "/api/recording/blob-upload";
const CONFIRM_URL = "/api/recording/chunk";

/** Deterministic, scoped blob path: a retry overwrites the same object. */
export function chunkPathname(
  recordingId: string,
  chunkIndex: number,
  mimeType: string,
): string {
  const ext = extensionForMimeType(mimeType);
  const padded = String(chunkIndex).padStart(6, "0");
  return `recordings/${recordingId}/chunk-${padded}.${ext}`;
}

/**
 * Production upload: presigned client upload to Vercel Blob via our handleUpload
 * route, then a server-side confirm that writes the recording_chunks row from the
 * authenticated session. The @vercel/blob client is dynamically imported so this
 * module stays loadable in a plain Node test (which injects a fake uploadFn and
 * never calls this).
 */
export const blobUpload: ChunkUploadFn = async (blob, pathname, ctx) => {
  const { upload } = await import("@vercel/blob/client");
  const result = await upload(pathname, blob, {
    // Private: critiq2-blob is a Private store, and call audio must never be
    // publicly fetchable (locked privacy model) — a chunk is read back later via a
    // token, not a public URL. A public-access write to the Private store is
    // rejected (503); access=private is both what the store accepts AND the
    // correct privacy posture for recordings.
    access: "private",
    handleUploadUrl: HANDLE_UPLOAD_URL,
    contentType: blob.type || undefined,
    clientPayload: JSON.stringify({
      recordingId: ctx.recordingId,
      chunkIndex: ctx.chunkIndex,
      segmentIndex: ctx.segmentIndex,
      sizeBytes: blob.size,
    }),
  });

  // Confirm from the authenticated client session — this is the reliable writer
  // of the chunk's DB row on both preview and localhost.
  const res = await fetch(CONFIRM_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      recordingId: ctx.recordingId,
      chunkIndex: ctx.chunkIndex,
      segmentIndex: ctx.segmentIndex,
      blobPathname: result.pathname,
      blobUrl: result.url,
      sizeBytes: blob.size,
    }),
  });
  if (!res.ok) throw new Error(`Chunk confirm failed: ${res.status}`);

  return { url: result.url, pathname: result.pathname };
};

export class ChunkUploader {
  private readonly recordingId: string;
  private readonly uploadFn: ChunkUploadFn;
  private readonly callbacks: UploaderCallbacks;
  private flushing = false;
  // Chunk indices currently uploading — prevents handleChunk and a concurrent
  // flushPending from uploading the same chunk twice.
  private readonly inFlight = new Set<number>();

  constructor(
    recordingId: string,
    opts?: { uploadFn?: ChunkUploadFn; callbacks?: UploaderCallbacks },
  ) {
    this.recordingId = recordingId;
    this.uploadFn = opts?.uploadFn ?? blobUpload;
    this.callbacks = opts?.callbacks ?? {};
  }

  /**
   * Persist a freshly-captured chunk (survives a failed upload / reload), then
   * attempt its upload. Returns whether the upload was confirmed this call; a
   * false leaves the chunk in the retry queue for a later flushPending().
   */
  async handleChunk(input: {
    chunkIndex: number;
    segmentIndex?: number;
    blob: Blob;
    mimeType: string;
  }): Promise<boolean> {
    const segmentIndex = input.segmentIndex ?? 0;
    await saveChunk({
      recordingId: this.recordingId,
      chunkIndex: input.chunkIndex,
      segmentIndex,
      blob: input.blob,
      mimeType: input.mimeType,
    });
    this.callbacks.onChunkState?.(input.chunkIndex, "pending");
    return this.uploadStored({
      recordingId: this.recordingId,
      chunkIndex: input.chunkIndex,
      segmentIndex,
      blob: input.blob,
      mimeType: input.mimeType,
    });
  }

  private async uploadStored(
    chunk: Pick<
      StoredChunk,
      "recordingId" | "chunkIndex" | "blob" | "mimeType"
    > & { segmentIndex?: number },
  ): Promise<boolean> {
    // Already uploading this exact chunk (handleChunk vs a concurrent flush)?
    // Skip — the in-flight attempt owns it; don't duplicate the upload/attempt.
    if (this.inFlight.has(chunk.chunkIndex)) return false;
    this.inFlight.add(chunk.chunkIndex);
    this.callbacks.onChunkState?.(chunk.chunkIndex, "uploading");
    try {
      await recordAttempt(chunk.recordingId, chunk.chunkIndex);
      const pathname = chunkPathname(
        chunk.recordingId,
        chunk.chunkIndex,
        chunk.mimeType,
      );
      await this.uploadFn(chunk.blob, pathname, {
        recordingId: chunk.recordingId,
        chunkIndex: chunk.chunkIndex,
        segmentIndex: chunk.segmentIndex ?? 0,
      });
      await confirmChunk(chunk.recordingId, chunk.chunkIndex);
      this.callbacks.onChunkState?.(chunk.chunkIndex, "uploaded");
      return true;
    } catch {
      // Stays in IndexedDB — flushPending() retries it later.
      this.callbacks.onChunkState?.(chunk.chunkIndex, "failed");
      return false;
    } finally {
      this.inFlight.delete(chunk.chunkIndex);
    }
  }

  /**
   * Drain the retry queue: re-upload every chunk still stored for this recording.
   * Idempotent — confirmed chunks are already evicted, so they're never retried.
   * Re-entrancy-guarded so overlapping triggers (failure + `online`) don't double
   * up.
   */
  async flushPending(): Promise<{ uploaded: number; remaining: number }> {
    if (this.flushing) {
      return { uploaded: 0, remaining: await this.remaining() };
    }
    this.flushing = true;
    let uploaded = 0;
    try {
      const pending = await listPendingChunks(this.recordingId);
      for (const chunk of pending) {
        const ok = await this.uploadStored(chunk);
        if (ok) uploaded += 1;
      }
    } finally {
      this.flushing = false;
    }
    return { uploaded, remaining: await this.remaining() };
  }

  async remaining(): Promise<number> {
    // Count-only (countFromIndex) — don't load every pending blob just to size it.
    return pendingCount(this.recordingId);
  }
}
