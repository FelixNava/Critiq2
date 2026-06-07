/**
 * Phase 12 unit verification — chunkStore (IndexedDB) + uploader retry logic.
 *
 * Imports the REAL app functions (no re-implementation, per the standing rule)
 * and exercises them with SYNTHETIC blobs against a fake IndexedDB + an injected
 * fake network. No DB, no browser, no live Blob store needed. The real mic
 * capture + presigned Blob upload are an on-device / preview gate, not this.
 *
 * Run: pnpm tsx scripts/verify-phase12.ts
 */
import "fake-indexeddb/auto";

async function main() {
  const store = await import("../src/lib/recording/chunkStore");
  const { ChunkUploader, chunkPathname } = await import(
    "../src/lib/recording/uploader"
  );

  const fails: string[] = [];
  const ok = (cond: boolean, msg: string) => {
    console.log(`${cond ? "✓" : "✗"} ${msg}`);
    if (!cond) fails.push(msg);
  };

  const mkBlob = (n: number) =>
    new Blob([new Uint8Array(n)], { type: "audio/webm" });

  // ---- chunkStore: save / list (sorted) / count / attempts / confirm-evict ----
  const rec = "rec-store-1";
  await store.saveChunk({ recordingId: rec, chunkIndex: 0, blob: mkBlob(100), mimeType: "audio/webm" });
  await store.saveChunk({ recordingId: rec, chunkIndex: 2, blob: mkBlob(200), mimeType: "audio/webm" });
  await store.saveChunk({ recordingId: rec, chunkIndex: 1, blob: mkBlob(300), mimeType: "audio/webm" });

  let pending = await store.listPendingChunks(rec);
  ok(pending.length === 3, "chunkStore: 3 saved chunks are pending");
  ok(
    pending.map((c) => c.chunkIndex).join(",") === "0,1,2",
    "chunkStore: listPendingChunks is sorted by chunkIndex",
  );
  ok((await store.pendingCount(rec)) === 3, "chunkStore: pendingCount is 3");
  ok(
    pending.find((c) => c.chunkIndex === 1)?.sizeBytes === 300,
    "chunkStore: stored sizeBytes derives from the blob",
  );

  await store.recordAttempt(rec, 1);
  await store.recordAttempt(rec, 1);
  pending = await store.listPendingChunks(rec);
  ok(
    pending.find((c) => c.chunkIndex === 1)?.attempts === 2,
    "chunkStore: recordAttempt bumps the attempt counter",
  );

  await store.confirmChunk(rec, 1);
  ok(
    (await store.pendingCount(rec)) === 2,
    "chunkStore: confirmChunk evicts the chunk (retry queue shrinks)",
  );
  ok(
    (await store.listPendingChunks(rec)).every((c) => c.chunkIndex !== 1),
    "chunkStore: the evicted chunk is gone",
  );

  // ---- pathname helper ----
  ok(
    chunkPathname("abc", 7, "audio/webm") === "recordings/abc/chunk-000007.webm",
    "uploader: chunkPathname is scoped + zero-padded + extensioned",
  );
  ok(
    chunkPathname("abc", 0, "audio/mp4") === "recordings/abc/chunk-000000.mp4",
    "uploader: chunkPathname maps the mp4 extension",
  );

  // ---- uploader: persist-first, retry until success, then evict ----
  const rec2 = "rec-upload-1";
  let attempts = 0;
  const flaky = async (_blob: Blob, pathname: string) => {
    attempts += 1;
    if (attempts < 3) throw new Error("simulated network failure");
    return { url: `https://blob.example/${pathname}`, pathname };
  };
  const uploader = new ChunkUploader(rec2, { uploadFn: flaky });

  const first = await uploader.handleChunk({ chunkIndex: 0, blob: mkBlob(500), mimeType: "audio/webm" });
  ok(first === false, "uploader: first attempt fails (network down)");
  ok(
    (await store.pendingCount(rec2)) === 1,
    "uploader: a failed chunk stays in IndexedDB (the retry queue)",
  );

  const flush1 = await uploader.flushPending(); // attempt #2 → still fails
  ok(
    flush1.uploaded === 0 && flush1.remaining === 1,
    "uploader: 2nd attempt still fails, chunk remains queued",
  );

  const flush2 = await uploader.flushPending(); // attempt #3 → succeeds
  ok(
    flush2.uploaded === 1 && flush2.remaining === 0,
    "uploader: 3rd attempt succeeds, chunk evicted",
  );
  ok(attempts === 3, "uploader: exactly 3 upload attempts were made");
  ok(
    (await store.pendingCount(rec2)) === 0,
    "uploader: the retry queue is empty after success",
  );

  // ---- uploader: a clean upload confirms + evicts on the first try ----
  const rec3 = "rec-upload-2";
  const good = async (_blob: Blob, pathname: string) => ({
    url: `https://blob.example/${pathname}`,
    pathname,
  });
  const uploader3 = new ChunkUploader(rec3, { uploadFn: good });
  const okUpload = await uploader3.handleChunk({ chunkIndex: 0, blob: mkBlob(64), mimeType: "audio/webm" });
  ok(okUpload === true, "uploader: a successful upload confirms on the first try");
  ok(
    (await store.pendingCount(rec3)) === 0,
    "uploader: confirmed chunk is evicted immediately",
  );

  if (fails.length) {
    console.error(`\n✗ ${fails.length} assertion(s) failed.`);
    process.exit(1);
  }
  console.log("\n✓ Phase 12 unit verification PASSED.");
}

main().catch((e) => {
  console.error("PROBE ERROR:", e);
  process.exit(1);
});
