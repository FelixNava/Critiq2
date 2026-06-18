import { NextResponse } from "next/server";
import {
  findRecordingsNeedingTranscription,
  STALE_PROCESSING_MS,
} from "@/lib/transcription/store";
import { runTranscriptionForRecording } from "@/lib/transcription/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_PER_SWEEP = 5;

/**
 * Transcription reliability sweeper. Finds completed recordings whose transcript
 * is missing / pending / failed / staled-out (a process that died mid-run > 15
 * min ago) and transcribes a bounded batch. This is the net for anything the
 * synchronous trigger missed (timeout, transient Deepgram error, a recording that
 * completed without a trigger). Gated by CRON_SECRET (Vercel Cron sends it as a
 * Bearer token); also accepts the same secret in `x-cron-secret` for manual runs.
 */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Cron not configured." },
      { status: 503 },
    );
  }
  const auth = req.headers.get("authorization");
  const alt = req.headers.get("x-cron-secret");
  if (auth !== `Bearer ${secret}` && alt !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const ids = await findRecordingsNeedingTranscription(MAX_PER_SWEEP);
  const results: Array<{ recordingId: string; status: string }> = [];
  for (const id of ids) {
    const outcome = await runTranscriptionForRecording(id);
    results.push({ recordingId: id, status: outcome.status });
  }

  return NextResponse.json({
    ok: true,
    swept: results.length,
    staleThresholdMs: STALE_PROCESSING_MS,
    results,
  });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
