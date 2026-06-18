import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRecordingForUser } from "@/lib/recordings";
import { getTranscriptForRecording } from "@/lib/transcription/store";

export const dynamic = "force-dynamic";

/**
 * Read a rep-owned recording's transcript (+ per-segment rows). 404 if the
 * recording isn't the rep's; 404 if no transcript has been produced yet.
 */
export async function GET(
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

  const transcript = await getTranscriptForRecording(recordingId);
  if (!transcript) {
    return NextResponse.json(
      { error: "No transcript yet." },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, transcript });
}
