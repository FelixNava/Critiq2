/**
 * Recording Infrastructure — Layer 6: IndexedDB chunk persistence (the local leg
 * of triple-persistence).
 *
 * Every captured chunk is written here FIRST, before any network upload, so it
 * survives a failed upload, a reload, or going offline. Per the locked policy
 * (D6): a chunk stays in IndexedDB until its remote upload is confirmed, then it
 * is evicted. So the set of stored chunks IS the retry queue — `listPendingChunks`
 * returns exactly what still needs uploading.
 *
 * Keyed by [recordingId, chunkIndex] so re-saving the same chunk is an upsert,
 * and an index on recordingId lets us scan/drain one recording's queue.
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export interface StoredChunk {
  recordingId: string;
  chunkIndex: number;
  blob: Blob;
  sizeBytes: number;
  mimeType: string;
  createdAt: number;
  attempts: number;
}

interface ChunkDBSchema extends DBSchema {
  chunks: {
    key: [string, number];
    value: StoredChunk;
    indexes: { "by-recording": string };
  };
}

const DB_NAME = "critiq-recordings";
const DB_VERSION = 1;
const STORE = "chunks";

let dbPromise: Promise<IDBPDatabase<ChunkDBSchema>> | null = null;

function getDb(): Promise<IDBPDatabase<ChunkDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<ChunkDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore(STORE, {
          keyPath: ["recordingId", "chunkIndex"],
        });
        store.createIndex("by-recording", "recordingId");
      },
    });
  }
  return dbPromise;
}

/** Persist a freshly-captured chunk (the un-confirmed / retry state, per D6). */
export async function saveChunk(input: {
  recordingId: string;
  chunkIndex: number;
  blob: Blob;
  mimeType: string;
}): Promise<void> {
  const db = await getDb();
  // get + put in ONE transaction so a concurrent writer can't clobber
  // createdAt/attempts (read-modify-write atomicity).
  const tx = db.transaction(STORE, "readwrite");
  const existing = await tx.store.get([input.recordingId, input.chunkIndex]);
  await tx.store.put({
    recordingId: input.recordingId,
    chunkIndex: input.chunkIndex,
    blob: input.blob,
    sizeBytes: input.blob.size,
    mimeType: input.mimeType,
    createdAt: existing?.createdAt ?? Date.now(),
    attempts: existing?.attempts ?? 0,
  });
  await tx.done;
}

/** Bump the retry counter for a chunk (one upload attempt). No-op if evicted. */
export async function recordAttempt(
  recordingId: string,
  chunkIndex: number,
): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(STORE, "readwrite");
  const existing = await tx.store.get([recordingId, chunkIndex]);
  if (existing) {
    await tx.store.put({ ...existing, attempts: existing.attempts + 1 });
  }
  await tx.done;
}

/** Confirm a chunk's upload → evict it from IndexedDB (D6). */
export async function confirmChunk(
  recordingId: string,
  chunkIndex: number,
): Promise<void> {
  const db = await getDb();
  await db.delete(STORE, [recordingId, chunkIndex]);
}

/** The retry queue = every chunk still stored (un-confirmed) for a recording. */
export async function listPendingChunks(
  recordingId: string,
): Promise<StoredChunk[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex(STORE, "by-recording", recordingId);
  return all.sort((a, b) => a.chunkIndex - b.chunkIndex);
}

export async function pendingCount(recordingId: string): Promise<number> {
  const db = await getDb();
  return db.countFromIndex(STORE, "by-recording", recordingId);
}

/** Drop all chunks for a recording (cleanup once the session is fully uploaded). */
export async function clearRecording(recordingId: string): Promise<void> {
  const pending = await listPendingChunks(recordingId);
  const db = await getDb();
  const tx = db.transaction(STORE, "readwrite");
  for (const c of pending) {
    void tx.store.delete([c.recordingId, c.chunkIndex]);
  }
  await tx.done;
}
