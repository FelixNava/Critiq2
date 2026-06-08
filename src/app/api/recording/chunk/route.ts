import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getRecordingForUser,
  recordChunkUploaded,
  isVercelBlobUrl,
  MAX_CHUNK_BYTES,
  MAX_CHUNK_INDEX,
} from "@/lib/recordings";

export const dynamic = "force-dynamic";

/**
 * Confirm a chunk's Blob upload and write its row, from the authenticated client
 * session. This is the reliable chunk-row writer (Vercel's onUploadCompleted
 * callback can't reach an SSO-protected preview and never fires on localhost).
 * Auth-gated + ownership-checked + pathname-scoped; idempotent on the row.
 */
export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: {
    recordingId?: unknown;
    chunkIndex?: unknown;
    segmentIndex?: unknown;
    blobPathname?: unknown;
    blobUrl?: unknown;
    sizeBytes?: unknown;
    durationMs?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const recordingId =
    typeof body.recordingId === "string" ? body.recordingId : "";
  const chunkIndex =
    typeof body.chunkIndex === "number" ? body.chunkIndex : Number.NaN;
  const segmentIndex =
    typeof body.segmentIndex === "number" ? body.segmentIndex : 0;
  const blobPathname =
    typeof body.blobPathname === "string" ? body.blobPathname : "";
  const blobUrl = typeof body.blobUrl === "string" ? body.blobUrl : "";
  const sizeBytes = typeof body.sizeBytes === "number" ? body.sizeBytes : 0;
  const durationMs = typeof body.durationMs === "number" ? body.durationMs : null;

  if (
    !recordingId ||
    !Number.isInteger(chunkIndex) ||
    chunkIndex < 0 ||
    chunkIndex >= MAX_CHUNK_INDEX ||
    !Number.isInteger(segmentIndex) ||
    segmentIndex < 0 ||
    segmentIndex >= MAX_CHUNK_INDEX ||
    sizeBytes < 0 ||
    sizeBytes > MAX_CHUNK_BYTES ||
    !blobPathname ||
    !blobUrl
  ) {
    return NextResponse.json(
      { error: "Missing or invalid chunk details." },
      { status: 400 },
    );
  }
  // The blob URL is client-supplied (from the upload() result); only trust a real
  // Vercel Blob host so a later transcribe/playback step can't be pointed elsewhere.
  if (!isVercelBlobUrl(blobUrl)) {
    return NextResponse.json({ error: "Invalid blob URL." }, { status: 400 });
  }

  const recording = await getRecordingForUser(userId, recordingId);
  if (!recording) {
    return NextResponse.json({ error: "Recording not found." }, { status: 404 });
  }
  if (
    blobPathname.includes("..") ||
    !blobPathname.startsWith(`recordings/${recordingId}/`)
  ) {
    return NextResponse.json(
      { error: "Chunk outside the recording scope." },
      { status: 400 },
    );
  }

  try {
    await recordChunkUploaded({
      recordingId,
      chunkIndex,
      segmentIndex,
      blobPathname,
      blobUrl,
      sizeBytes,
      durationMs,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("chunk confirm failed", err);
    return NextResponse.json(
      { error: "Something went wrong. Try again." },
      { status: 500 },
    );
  }
}
