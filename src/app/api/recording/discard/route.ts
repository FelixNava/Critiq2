import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { discardRecording } from "@/lib/recordings";

export const dynamic = "force-dynamic";

/**
 * Discard a capture session the rep chose not to keep (rep-owned soft-delete).
 * Used when auto-recovery is exhausted and the rep declines to save the partial
 * recording — the recorder never auto-discards; only the rep does.
 */
export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: { recordingId?: unknown };
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

  const ok = await discardRecording(userId, recordingId);
  if (!ok) {
    return NextResponse.json({ error: "Recording not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
