import { NextResponse } from "next/server";
import {
  STALE_PROCESSING_MS,
  findRepsNeedingConsolidation,
} from "@/lib/repconsolidation/store";
import { runRepConsolidation } from "@/lib/repconsolidation/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_PER_SWEEP = 5;

/**
 * Rep consolidation sweeper (Phase 24) — the GUARANTEED path for the locked "regenerate
 * the rep profile every 10 debriefs" job. Finds reps whose completed-debrief count has
 * crossed a new multiple of the interval (new material), plus pending/failed retries
 * under the cap and stale processing claims, and consolidates a bounded batch. The
 * debrief route also fires a best-effort post-response trigger, but a serverless function
 * can freeze after responding, so THIS is the reliable mechanism. Gated by CRON_SECRET
 * (Vercel Cron sends it as a Bearer token); also accepts `x-cron-secret`.
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

  const ids = await findRepsNeedingConsolidation(MAX_PER_SWEEP);
  const results: Array<{ userId: string; status: string }> = [];
  for (const id of ids) {
    const outcome = await runRepConsolidation(id);
    results.push({ userId: id, status: outcome.status });
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
