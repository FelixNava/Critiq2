import { NextResponse } from "next/server";
import {
  findRecordingsNeedingScoring,
  STALE_PROCESSING_MS,
} from "@/lib/scoring/store";
import { runScoringForRecording } from "@/lib/scoring/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_PER_SWEEP = 5;

/**
 * Scoring reliability sweeper. Finds recordings whose transcript is ready
 * (completed/partial with text) but whose score is missing / pending / failed /
 * staled-out (a process that died mid-run > 15 min ago) and scores a bounded
 * batch. This is the net for anything the synchronous trigger missed (timeout,
 * transient Anthropic error, a recording transcribed without a score trigger).
 * Gated by CRON_SECRET (Vercel Cron sends it as a Bearer token); also accepts the
 * same secret in `x-cron-secret` for manual runs.
 */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Cron not configured." }, { status: 503 });
  }
  const authHeader = req.headers.get("authorization");
  const alt = req.headers.get("x-cron-secret");
  if (authHeader !== `Bearer ${secret}` && alt !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const ids = await findRecordingsNeedingScoring(MAX_PER_SWEEP);
  const results: Array<{ recordingId: string; status: string }> = [];
  for (const id of ids) {
    const outcome = await runScoringForRecording(id);
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
