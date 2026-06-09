/**
 * Server-side recordings data layer (episodic memory tier). Mirrors the shape of
 * src/lib/accounts.ts: thin, typed helpers the API routes call, with ownership
 * (the rep owns the recording) as the access boundary.
 *
 * The chunk-row writer is idempotent (UNIQUE recording_id + chunk_index) so it
 * can be driven both by the authenticated client confirm AND by Vercel's
 * best-effort onUploadCompleted callback without double-inserting.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { recordings, recordingChunks, type Recording } from "@/db/schema";

export const RECORDING_STATUSES = [
  "recording",
  "completed",
  "failed",
  "aborted",
] as const;
export type RecordingStatus = (typeof RECORDING_STATUSES)[number];

// Input guards shared by the recording routes: cap chunk_index well under the
// INT4 ceiling (a million 5s chunks is ~57 days) and bound a single chunk's size.
export const MAX_CHUNK_INDEX = 1_000_000;
export const MAX_CHUNK_BYTES = 25 * 1024 * 1024;

/** A blob URL we'll trust: https on a Vercel Blob host (mirrors the SDK check). */
export function isVercelBlobUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && u.hostname.endsWith(".blob.vercel-storage.com");
  } catch {
    return false;
  }
}

/** Create a capture session for a rep. accountId is optional (standalone dev). */
export async function createRecording(
  userId: string,
  accountId: string | null = null,
): Promise<string> {
  const [row] = await db
    .insert(recordings)
    .values({ userId, accountId, status: "recording" })
    .returning({ id: recordings.id });
  return row.id;
}

/** Fetch a recording IFF it belongs to the rep (ownership = access boundary). */
export async function getRecordingForUser(
  userId: string,
  recordingId: string,
): Promise<Recording | null> {
  const rows = await db
    .select()
    .from(recordings)
    .where(and(eq(recordings.id, recordingId), eq(recordings.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Record a confirmed chunk upload. Idempotent on (recordingId, chunkIndex): a
 * duplicate confirm (retry, or both the client-confirm and the callback firing)
 * updates the existing row rather than erroring. The caller must already have
 * proven the rep owns the recording.
 */
export async function recordChunkUploaded(input: {
  recordingId: string;
  chunkIndex: number;
  segmentIndex?: number;
  blobPathname: string;
  blobUrl: string;
  sizeBytes: number;
  durationMs?: number | null;
}): Promise<void> {
  const segmentIndex = input.segmentIndex ?? 0;
  await db
    .insert(recordingChunks)
    .values({
      recordingId: input.recordingId,
      chunkIndex: input.chunkIndex,
      segmentIndex,
      blobPathname: input.blobPathname,
      blobUrl: input.blobUrl,
      sizeBytes: input.sizeBytes,
      durationMs: input.durationMs ?? null,
      status: "uploaded",
      uploadedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [recordingChunks.recordingId, recordingChunks.chunkIndex],
      set: {
        segmentIndex,
        blobPathname: input.blobPathname,
        blobUrl: input.blobUrl,
        sizeBytes: input.sizeBytes,
        status: "uploaded",
        uploadedAt: new Date(),
      },
    });
}

/** Mark a recording finished (rep-owned). Returns false if not found/owned. */
export async function completeRecording(
  userId: string,
  recordingId: string,
  input: {
    durationMs?: number | null;
    chunkCount?: number | null;
    gapMs?: number | null;
    gapCount?: number | null;
    status?: RecordingStatus;
  } = {},
): Promise<boolean> {
  const result = await db
    .update(recordings)
    .set({
      status: input.status ?? "completed",
      endedAt: new Date(),
      durationMs: input.durationMs ?? null,
      chunkCount: input.chunkCount ?? 0,
      gapMs: input.gapMs ?? null,
      gapCount: input.gapCount ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(recordings.id, recordingId), eq(recordings.userId, userId)))
    .returning({ id: recordings.id });
  return result.length > 0;
}
