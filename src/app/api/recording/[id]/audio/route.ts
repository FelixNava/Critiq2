import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRecordingForUser, getAudioChunkRefs } from "@/lib/recordings";
import {
  buildAudioPlan,
  resolveRange,
  selectParts,
  type AudioPlanStatus,
  type PartSlice,
} from "@/lib/recording/audioPlan";
import { blobChunkFetcher } from "@/lib/transcription/blobFetcher";

export const dynamic = "force-dynamic";
// A full-body fetch streams every chunk of a (≤10-min single) segment in order;
// give it headroom. Media elements normally request small ranges, so this is the
// worst case, not the common one.
export const maxDuration = 60;

/**
 * Stream a rep-owned recording's audio (Phase 38c). The Blob store is PRIVATE, so
 * this route ALWAYS proxies bytes server-side with the Blob token — a blob_url is
 * never handed to the browser (docs/CALL_ANALYSIS_AUDIO_CONTRACT.md §A1). Supports
 * HTTP Range so the native <audio> element can seek + the iOS `bytes=0-1` probe
 * works. Only a single dense capture segment is playable today; multi-segment
 * assembly is deferred to the device gate (contract §D1) and degrades honestly.
 *
 * Auth: 401 unauthenticated; 404 if the recording isn't the rep's (ownership =
 * access boundary); 422 when there's no playable single-segment audio.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await params;
  const recording = await getRecordingForUser(userId, id);
  if (!recording || recording.deletedAt) {
    return NextResponse.json({ error: "Recording not found." }, { status: 404 });
  }

  const plan = buildAudioPlan(await getAudioChunkRefs(id));
  if (plan.status !== "ready") {
    // The detail page gates the player on availability, so a non-ready status is
    // mostly a direct-hit guard. JSON (not a media body) with the reason.
    return NextResponse.json(
      { error: audioUnavailableMessage(plan.status), reason: plan.status },
      { status: 422, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const resolution = resolveRange(req.headers.get("range"), plan.totalBytes);

  const baseHeaders: Record<string, string> = {
    "Content-Type": plan.contentType,
    "Accept-Ranges": "bytes",
    // Private call audio must never land in a shared/edge cache.
    "Cache-Control": "private, no-store",
  };

  if (resolution.kind === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: { ...baseHeaders, "Content-Range": `bytes */${plan.totalBytes}` },
    });
  }

  if (resolution.kind === "partial") {
    const { start, end } = resolution;
    const slices = selectParts(plan.parts, start, end);
    return new Response(streamSlices(slices), {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes ${start}-${end}/${plan.totalBytes}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }

  // Full body (200) — no/blank range.
  const slices = selectParts(plan.parts, 0, plan.totalBytes - 1);
  return new Response(streamSlices(slices), {
    status: 200,
    headers: { ...baseHeaders, "Content-Length": String(plan.totalBytes) },
  });
}

/**
 * Stream the selected chunk slices in order, fetching ONE chunk per consumer
 * pull (natural backpressure → bounded memory). Each chunk's private bytes are
 * read via the authenticated Blob reader; we clamp the slice to the actual chunk
 * length so a drifted size_bytes row can never read out of bounds.
 */
function streamSlices(slices: PartSlice[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (i >= slices.length) {
        controller.close();
        return;
      }
      const slice = slices[i++];
      try {
        const { bytes } = await blobChunkFetcher.fetchChunk(slice.blobUrl);
        const readEnd = Math.min(slice.readEnd, bytes.length);
        const readStart = Math.min(slice.readStart, readEnd);
        controller.enqueue(bytes.subarray(readStart, readEnd));
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

function audioUnavailableMessage(status: AudioPlanStatus): string {
  switch (status) {
    case "multisegment":
      return "Multi-part playback isn't available yet for this call.";
    case "incomplete":
      return "This recording's audio didn't finish uploading.";
    default:
      return "No audio is stored for this call.";
  }
}
