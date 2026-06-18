import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRecordingForUser } from "@/lib/recordings";
import { runTranscriptionForRecording } from "@/lib/transcription/runner";
import { getTranscriptForRecording } from "@/lib/transcription/store";

export const dynamic = "force-dynamic";
// Transcription is a multi-segment Deepgram round-trip; give it room (beta scale
// = a handful of ~10-min segments). Vercel caps this per plan; long recordings
// are also covered by the cron sweeper as a fallback.
export const maxDuration = 300;

/**
 * Trigger transcription for a completed, rep-owned recording. Synchronous: it
 * runs the Deepgram pipeline and returns the resulting transcript. Idempotent —
 * an already-completed or in-progress transcript is returned/short-circuited
 * rather than re-run (the claim lives in the store). The cron sweeper is the
 * reliability net for anything that fails or times out here.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id: recordingId } = await params;
  const recording = await getRecordingForUser(userId, recordingId);
  if (!recording) {
    return NextResponse.json({ error: "Recording not found." }, { status: 404 });
  }
  if (recording.status !== "completed") {
    return NextResponse.json(
      { error: "This recording isn't finished yet." },
      { status: 409 },
    );
  }

  const outcome = await runTranscriptionForRecording(recordingId);
  if (outcome.status === "failed") {
    return NextResponse.json(
      { error: "Transcription failed.", detail: outcome.error },
      { status: 502 },
    );
  }

  const transcript = await getTranscriptForRecording(recordingId);
  return NextResponse.json({ ok: true, outcome, transcript });
}
