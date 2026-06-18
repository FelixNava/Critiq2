import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRecordingForUser } from "@/lib/recordings";
import { runScoringForRecording } from "@/lib/scoring/runner";
import { getScoreForRecording } from "@/lib/scoring/store";

export const dynamic = "force-dynamic";
// Scoring is a single Claude round-trip over the transcript (adaptive thinking +
// a 12-dimension structured output). Give it room; the cron sweeper is the
// fallback for timeouts.
export const maxDuration = 300;

/**
 * Trigger scoring for a rep-owned recording whose transcript is ready.
 * Synchronous: runs the Claude pipeline and returns the resulting score.
 * Idempotent — an already-completed or in-progress score is short-circuited
 * rather than re-run (the claim lives in the store). 409 if there's no scorable
 * transcript yet. The cron sweeper is the reliability net.
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

  const outcome = await runScoringForRecording(recordingId);
  if (outcome.status === "no-transcript") {
    return NextResponse.json(
      { error: "No transcript to score yet. Transcribe the recording first." },
      { status: 409 },
    );
  }
  if (outcome.status === "failed") {
    return NextResponse.json(
      { error: "Scoring failed.", detail: outcome.error },
      { status: 502 },
    );
  }

  const score = await getScoreForRecording(recordingId);
  return NextResponse.json({ ok: true, outcome, score });
}

/**
 * Read a rep-owned recording's score. 404 if the recording isn't the rep's; 404
 * if no score has been produced yet.
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

  const score = await getScoreForRecording(recordingId);
  if (!score) {
    return NextResponse.json({ error: "No score yet." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, score });
}
