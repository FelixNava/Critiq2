/**
 * Server-side chunk byte reader (Phase 15; fixed Phase 38). Reads a stored audio
 * chunk's bytes + content type back from Vercel Blob so we can hand the
 * concatenated segment to Deepgram.
 *
 * The store is PRIVATE (uploads use `access: "private"`), so a plain
 * unauthenticated `fetch(blobUrl)` returns 403 — which is exactly why every real
 * recording transcribed to zero words before this fix. We read through the
 * @vercel/blob SDK's authenticated `get()` instead (it uses BLOB_READ_WRITE_TOKEN
 * from the environment), with `useCache: false` so a just-uploaded chunk is
 * always served fresh from origin storage rather than a cold CDN edge.
 */

import { get } from "@vercel/blob";
import { isVercelBlobUrl } from "@/lib/recordings";
import type { ChunkFetcher } from "./types";

export const blobChunkFetcher: ChunkFetcher = {
  async fetchChunk(blobUrl: string) {
    if (!isVercelBlobUrl(blobUrl)) {
      throw new Error("Refusing to fetch a non-Vercel-Blob URL.");
    }
    // Authenticated private read (token from BLOB_READ_WRITE_TOKEN). Returns a
    // stream + metadata, or null if the blob is gone.
    const result = await get(blobUrl, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200) {
      throw new Error(
        `Failed to read chunk from Blob (${result ? result.statusCode : "not found"}).`,
      );
    }
    const contentType =
      result.blob.contentType ||
      result.headers.get("content-type") ||
      "audio/webm";
    const bytes = new Uint8Array(await new Response(result.stream).arrayBuffer());
    return { bytes, contentType };
  },
};
