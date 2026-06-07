import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { auth } from "@/auth";
import {
  getRecordingForUser,
  recordChunkUploaded,
  MAX_CHUNK_BYTES,
  MAX_CHUNK_INDEX,
} from "@/lib/recordings";

export const dynamic = "force-dynamic";

// audio/* covers every container+codec MediaRecorder emits — e.g.
// "audio/webm;codecs=opus", which Vercel matches via the "audio/*" wildcard but
// NOT against a bare "audio/webm" entry (it does exact-or-"type/*"). The bare
// list would silently reject real Chrome/Android chunks. application/octet-stream
// covers a blob with no type.
const ALLOWED_CONTENT_TYPES = ["audio/*", "application/octet-stream"];

interface ChunkClientPayload {
  recordingId: string;
  chunkIndex: number;
  sizeBytes?: number;
}

/**
 * Presigned client-upload token issuer for audio chunks.
 *
 * onBeforeGenerateToken is the AUTH gate: the rep must be signed in, must own the
 * target recording, and the requested pathname must live under that recording's
 * scoped prefix — so a client can never write into another rep's recording.
 *
 * onUploadCompleted is a best-effort, idempotent backup writer. It is NOT relied
 * on: Vercel calls it server-to-server, which can't reach an SSO-protected
 * preview and never fires on localhost. The authenticated client confirm
 * (POST /api/recording/chunk) is the reliable row writer.
 */
export async function POST(req: Request): Promise<NextResponse> {
  let body: HandleUploadBody;
  try {
    body = (await req.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const session = await auth();
        const userId = session?.user?.id;
        if (!userId) throw new Error("Unauthorized");

        let payload: ChunkClientPayload;
        try {
          payload = JSON.parse(clientPayload ?? "{}");
        } catch {
          throw new Error("Invalid client payload");
        }
        const { recordingId, chunkIndex } = payload;
        if (typeof recordingId !== "string" || typeof chunkIndex !== "number") {
          throw new Error("Missing recording reference");
        }
        if (
          !Number.isInteger(chunkIndex) ||
          chunkIndex < 0 ||
          chunkIndex >= MAX_CHUNK_INDEX
        ) {
          throw new Error("Invalid chunk index");
        }

        const recording = await getRecordingForUser(userId, recordingId);
        if (!recording) throw new Error("Recording not found");
        // Reject `..` so a scoped prefix can't be escaped via path traversal.
        if (
          pathname.includes("..") ||
          !pathname.startsWith(`recordings/${recordingId}/`)
        ) {
          throw new Error("Pathname outside the recording scope");
        }

        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_CHUNK_BYTES,
          addRandomSuffix: false,
          // A retried chunk re-writes the same pathname idempotently.
          allowOverwrite: true,
          tokenPayload: JSON.stringify({
            recordingId,
            chunkIndex,
            userId,
            sizeBytes: payload.sizeBytes ?? 0,
          }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        if (!tokenPayload) return;
        const { recordingId, chunkIndex, sizeBytes } = JSON.parse(
          tokenPayload,
        ) as {
          recordingId: string;
          chunkIndex: number;
          userId: string;
          sizeBytes: number;
        };
        await recordChunkUploaded({
          recordingId,
          chunkIndex,
          blobPathname: blob.pathname,
          blobUrl: blob.url,
          sizeBytes: sizeBytes ?? 0,
        });
      },
    });
    return NextResponse.json(json);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    const status = message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
