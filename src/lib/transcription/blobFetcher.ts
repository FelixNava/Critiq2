/**
 * Server-side chunk byte reader (Phase 15). Reads a stored audio chunk's bytes +
 * content type back from Vercel Blob so we can hand the concatenated segment to
 * Deepgram. Chunks are stored at public `*.blob.vercel-storage.com` URLs (the
 * presigned client upload returns the public URL we persist), so a plain GET
 * returns the bytes and the `Content-Type` header we forward to Deepgram.
 */

import { isVercelBlobUrl } from "@/lib/recordings";
import type { ChunkFetcher } from "./types";

export const blobChunkFetcher: ChunkFetcher = {
  async fetchChunk(blobUrl: string) {
    if (!isVercelBlobUrl(blobUrl)) {
      throw new Error("Refusing to fetch a non-Vercel-Blob URL.");
    }
    const res = await fetch(blobUrl, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Failed to read chunk from Blob (${res.status}).`);
    }
    const contentType = res.headers.get("content-type") || "audio/webm";
    const buf = new Uint8Array(await res.arrayBuffer());
    return { bytes: buf, contentType };
  },
};
