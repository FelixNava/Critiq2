import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, recordings, recordingChunks } from "@/db/schema";

/**
 * Permanently delete a rep's account and ALL their private data (Phase 37c).
 *
 * Order matters: the audio chunks live in Vercel Blob (NOT Postgres), so we must
 * delete those objects BEFORE the user row — once `users` is deleted the FK cascade
 * removes the chunk rows that hold the blob URLs, and we'd lose the keys. Everything
 * else (intake, recordings, transcripts, scores, briefs, scripts, debriefs, coaching,
 * the learned rep model, rep context, push subscriptions, auth sessions, account-rep
 * links) is removed by the `onDelete: cascade` FKs on the users row. Shared account
 * records survive with `created_by` set null — the locked privacy model: account
 * intelligence is shared, rep-agnostic, and outlives any one rep.
 *
 * Blob deletion is BEST-EFFORT: a Blob failure (e.g. the token is absent in a local
 * dev environment, or a transient error) must NOT block the account deletion itself —
 * the DB rows are the system of record. We log and continue so the user's row is always
 * removed; a stray blob is recoverable by a later sweep, an un-deletable account is not.
 */
export async function purgeUserAccount(userId: string): Promise<void> {
  // 1) Collect the rep's audio blob URLs across ALL their recordings (including
  //    discarded captures whose blobs were left for cleanup).
  const chunkRows = await db
    .select({ blobUrl: recordingChunks.blobUrl })
    .from(recordingChunks)
    .innerJoin(recordings, eq(recordingChunks.recordingId, recordings.id))
    .where(eq(recordings.userId, userId));

  const blobUrls = chunkRows
    .map((r) => r.blobUrl)
    .filter((u): u is string => typeof u === "string" && u.length > 0);

  // 2) Best-effort delete the audio objects from Vercel Blob, in bounded batches.
  if (blobUrls.length > 0) {
    try {
      const { del } = await import("@vercel/blob");
      const BATCH = 100;
      for (let i = 0; i < blobUrls.length; i += BATCH) {
        await del(blobUrls.slice(i, i + BATCH));
      }
    } catch (err) {
      console.error(
        `[account-delete] blob cleanup failed for user ${userId} (${blobUrls.length} objects); continuing with row delete`,
        err,
      );
    }
  }

  // 3) Delete the user row — the FK cascade removes every rep-private row.
  await db.delete(users).where(eq(users.id, userId));
}
