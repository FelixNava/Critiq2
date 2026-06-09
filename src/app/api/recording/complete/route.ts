import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { completeRecording } from "@/lib/recordings";

export const dynamic = "force-dynamic";

/**
 * Mark a capture session finished (rep-owned). Records end time, duration, and
 * the final chunk count. A status of "aborted" is accepted for an abandoned
 * session so the row reflects what actually happened.
 */
export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: {
    recordingId?: unknown;
    durationMs?: unknown;
    chunkCount?: unknown;
    status?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const recordingId =
    typeof body.recordingId === "string" ? body.recordingId : "";
  if (!recordingId) {
    return NextResponse.json(
      { error: "Missing recording reference." },
      { status: 400 },
    );
  }
  const durationMs =
    typeof body.durationMs === "number" ? body.durationMs : null;
  const chunkCount =
    typeof body.chunkCount === "number" ? body.chunkCount : null;
  const status = body.status === "aborted" ? "aborted" : "completed";

  const ok = await completeRecording(userId, recordingId, {
    durationMs,
    chunkCount,
    status,
  });
  if (!ok) {
    return NextResponse.json({ error: "Recording not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
