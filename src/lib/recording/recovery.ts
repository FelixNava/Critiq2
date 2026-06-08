/**
 * Recording Infrastructure — Phase 13: resume-after-tab-kill recovery.
 *
 * If the tab/app is killed mid-recording, the un-confirmed chunks survive in
 * IndexedDB (chunkStore, D6). On the next load we find those orphaned recordings
 * and drain their retry queues to Vercel Blob, then best-effort mark each
 * recording finished. Runs once on mount, BEFORE any new recording, so it never
 * races an active session.
 *
 * The store scan, the uploader, and the completion call are all injectable so the
 * flow is unit-tested against a fake IndexedDB + a fake network
 * (scripts/verify-phase13.ts) — no browser, no live Blob store.
 */

import { listRecordingIdsWithPending } from "./chunkStore";
import { ChunkUploader } from "./uploader";

export interface OrphanRecoveryResult {
  recordingId: string;
  /** Chunks uploaded this pass. */
  recovered: number;
  /** Chunks still queued (couldn't upload — stays for the next load). */
  remaining: number;
}

export interface RecoverOrphansDeps {
  listIds?: () => Promise<string[]>;
  makeUploader?: (recordingId: string) => ChunkUploader;
  complete?: (recordingId: string) => Promise<void>;
}

/** Best-effort POST to mark a fully-drained recording complete (rep-owned server-side). */
async function defaultComplete(recordingId: string): Promise<void> {
  await fetch("/api/recording/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recordingId, status: "completed" }),
  }).catch(() => {
    // Best-effort; the row stays open and a later load retries.
  });
}

/**
 * Drain every orphaned recording's retry queue. Returns one result per orphan
 * (so the UI can say "recovered N clips from an interrupted session").
 */
export async function recoverOrphanedRecordings(
  opts: { excludeRecordingId?: string; deps?: RecoverOrphansDeps } = {},
): Promise<OrphanRecoveryResult[]> {
  const deps = opts.deps ?? {};
  const listIds = deps.listIds ?? listRecordingIdsWithPending;
  const makeUploader =
    deps.makeUploader ?? ((id: string) => new ChunkUploader(id));
  const complete = deps.complete ?? defaultComplete;

  const ids = (await listIds()).filter(
    (id) => id !== opts.excludeRecordingId,
  );

  const results: OrphanRecoveryResult[] = [];
  for (const id of ids) {
    const uploader = makeUploader(id);
    const { uploaded, remaining } = await uploader.flushPending();
    // Only finalize once the queue is fully drained. A still-pending orphan is
    // left open (status 'recording') for the next load to finish — never flip a
    // recording to 'failed' on a transient offline blip (which would also let the
    // status oscillate across loads).
    if (remaining === 0) await complete(id);
    results.push({ recordingId: id, recovered: uploaded, remaining });
  }
  return results;
}
