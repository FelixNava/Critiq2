/**
 * Server-side recordings data layer (episodic memory tier). Mirrors the shape of
 * src/lib/accounts.ts: thin, typed helpers the API routes call, with ownership
 * (the rep owns the recording) as the access boundary.
 *
 * The chunk-row writer is idempotent (UNIQUE recording_id + chunk_index) so it
 * can be driven both by the authenticated client confirm AND by Vercel's
 * best-effort onUploadCompleted callback without double-inserting.
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  recordings,
  recordingChunks,
  recordingTranscripts,
  callScores,
  accountsTbl,
  type Recording,
} from "@/db/schema";
import type { AudioChunkRef } from "@/lib/recording/audioPlan";

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
 * Chunk metadata for audio PLAYBACK (Phase 38c), distinct from the transcription
 * reader `getChunkRefsForRecording` which silently filters to status='uploaded'
 * and omits blob_pathname/size_bytes. Playback needs ALL rows (to detect a
 * non-dense / partly-unuploaded sequence → honest "incomplete") plus size_bytes
 * (for the byte timeline) and blob_pathname (for Content-Type). Ordered by
 * chunk_index. The caller must already have proven the rep owns the recording.
 */
export async function getAudioChunkRefs(
  recordingId: string,
): Promise<AudioChunkRef[]> {
  return db
    .select({
      chunkIndex: recordingChunks.chunkIndex,
      segmentIndex: recordingChunks.segmentIndex,
      blobUrl: recordingChunks.blobUrl,
      blobPathname: recordingChunks.blobPathname,
      sizeBytes: recordingChunks.sizeBytes,
      status: recordingChunks.status,
    })
    .from(recordingChunks)
    .where(eq(recordingChunks.recordingId, recordingId))
    .orderBy(recordingChunks.chunkIndex);
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

/**
 * A row in the rep's recordings inbox (Phase 34b). Joins the recording with its
 * (optional) account name and the derived transcript + score state so the inbox
 * can show, at a glance, where each capture is in the pipeline without the list
 * page assembling it. Owner-scoped; the bytes/chunks aren't needed here.
 */
export type RecordingListItem = {
  id: string;
  title: string | null;
  status: string;
  startedAt: Date;
  durationMs: number | null;
  gapMs: number | null;
  gapCount: number | null;
  chunkCount: number;
  accountId: string | null;
  /** Null when unassigned OR the assigned account was soft-deleted. */
  accountName: string | null;
  transcriptStatus: string | null;
  scoreStatus: string | null;
  overallScore: number | null;
};

/**
 * List a rep's recordings (newest first), with the assigned account name and the
 * transcript/score state folded in. Owner-scoped (the rep owns the recording)
 * and excludes soft-deleted/discarded captures. The account join is guarded by
 * the account's own soft-delete so a deleted account reads as "unassigned"
 * rather than surfacing a dangling name. The transcript + score tables are
 * UNIQUE per recording, so the LEFT JOINs never multiply rows.
 */
export async function listRecordingsForUser(
  userId: string,
): Promise<RecordingListItem[]> {
  const rows = await db
    .select({
      id: recordings.id,
      title: recordings.title,
      status: recordings.status,
      startedAt: recordings.startedAt,
      durationMs: recordings.durationMs,
      gapMs: recordings.gapMs,
      gapCount: recordings.gapCount,
      chunkCount: recordings.chunkCount,
      accountId: recordings.accountId,
      accountName: accountsTbl.name,
      transcriptStatus: recordingTranscripts.status,
      scoreStatus: callScores.status,
      overallScore: callScores.overallScore,
    })
    .from(recordings)
    .leftJoin(
      accountsTbl,
      and(
        eq(accountsTbl.id, recordings.accountId),
        isNull(accountsTbl.deletedAt),
      ),
    )
    .leftJoin(
      recordingTranscripts,
      eq(recordingTranscripts.recordingId, recordings.id),
    )
    .leftJoin(callScores, eq(callScores.recordingId, recordings.id))
    .where(and(eq(recordings.userId, userId), isNull(recordings.deletedAt)))
    .orderBy(desc(recordings.startedAt));

  return rows;
}

/**
 * A recording the rep can attach to a debrief (Phase 34d). Scoped to ONE account:
 * only the rep's recordings already assigned to that account, with the title/date
 * label inputs + the transcript/score pipeline state so the debrief picker can show
 * whether a score is (or will be) available. Mirrors the inbox row but trimmed to
 * what the picker needs.
 */
export type AccountRecordingOption = {
  id: string;
  title: string | null;
  startedAt: Date;
  durationMs: number | null;
  status: string;
  transcriptStatus: string | null;
  scoreStatus: string | null;
  overallScore: number | null;
};

/**
 * List the rep's recordings ASSIGNED TO a specific account (newest first) for the
 * debrief attach-a-recording picker (Phase 34d). Double-scoped: the rep owns the
 * recording (userId) AND it's assigned to this account (accountId) — the same
 * linkage the debrief route re-verifies before storing recordingId. Excludes
 * soft-deleted captures. The transcript + score tables are UNIQUE per recording so
 * the LEFT JOINs never multiply rows. The CALLER must already have verified the rep
 * has access to the account (getAccountForUser).
 */
export async function listAssignedRecordingsForAccount(
  userId: string,
  accountId: string,
): Promise<AccountRecordingOption[]> {
  const rows = await db
    .select({
      id: recordings.id,
      title: recordings.title,
      startedAt: recordings.startedAt,
      durationMs: recordings.durationMs,
      status: recordings.status,
      transcriptStatus: recordingTranscripts.status,
      scoreStatus: callScores.status,
      overallScore: callScores.overallScore,
    })
    .from(recordings)
    .leftJoin(
      recordingTranscripts,
      eq(recordingTranscripts.recordingId, recordings.id),
    )
    .leftJoin(callScores, eq(callScores.recordingId, recordings.id))
    .where(
      and(
        eq(recordings.userId, userId),
        eq(recordings.accountId, accountId),
        isNull(recordings.deletedAt),
      ),
    )
    .orderBy(desc(recordings.startedAt));

  return rows;
}

/**
 * Manually assign (or re-assign / clear) a recording's account, and optionally
 * set its title (Phase 34c). Rep-owned (the WHERE scopes to userId), so a rep
 * can't touch another rep's recording. The CALLER must already have verified the
 * rep has access to the target account (getAccountForUser) when accountId is
 * non-null — this layer only enforces recording ownership. Passing accountId
 * null clears the assignment. Returns false if the recording isn't found/owned.
 */
export async function setRecordingAccount(
  userId: string,
  recordingId: string,
  accountId: string | null,
  title?: string | null,
): Promise<boolean> {
  const set: {
    accountId: string | null;
    updatedAt: Date;
    title?: string | null;
  } = { accountId, updatedAt: new Date() };
  if (title !== undefined) set.title = title;

  const result = await db
    .update(recordings)
    .set(set)
    .where(and(eq(recordings.id, recordingId), eq(recordings.userId, userId)))
    .returning({ id: recordings.id });
  return result.length > 0;
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

/**
 * Discard a capture session the rep chose not to keep (mic was lost and they
 * declined to save the partial). Soft-delete (deletedAt + status 'aborted'),
 * rep-owned. Returns false if not found/owned. The audio blobs are left for a
 * later cleanup sweep; the row is hidden from any listing immediately.
 */
export async function discardRecording(
  userId: string,
  recordingId: string,
): Promise<boolean> {
  const now = new Date();
  const result = await db
    .update(recordings)
    .set({ status: "aborted", endedAt: now, deletedAt: now, updatedAt: now })
    .where(and(eq(recordings.id, recordingId), eq(recordings.userId, userId)))
    .returning({ id: recordings.id });
  return result.length > 0;
}
