import { NextResponse, after } from "next/server";
import { auth } from "@/auth";
import { getAccountForUser } from "@/lib/accounts";
import { getRecordingForUser } from "@/lib/recordings";
import { generateDebriefForAccount } from "@/lib/debrief/generate";
import { hasNarrative, normalizeReport } from "@/lib/debrief/reporter";
import {
  getDebriefForUser,
  getLatestDebriefForAccount,
} from "@/lib/debrief/store";
import { runConsolidationForAccount } from "@/lib/consolidation/runner";
import { runRepConsolidation } from "@/lib/repconsolidation/runner";

export const dynamic = "force-dynamic";
// Up to three Claude round-trips can run in this invocation: the debrief itself
// (synchronous — the rep waits) and then, via after() (post-response), the Phase 23
// account consolidation (every debrief) and the Phase 24 rep consolidation (only when the
// rep crosses a new multiple of 10 — otherwise the runner no-ops cheaply with no Claude
// call). after() shares this function's budget, so allow headroom; the rep's response is
// sent after the first call, so the larger ceiling only affects the background work. The
// /api/cron/consolidate-accounts and /api/cron/consolidate-reps sweepers are the net if
// this is cut short.
export const maxDuration = 300;

/**
 * Create a Reporter-Mode debrief for a rep-owned account. The rep's guided answers
 * are normalized + length-clamped; only the core narrative ("what happened") is
 * required. Returns the generated debrief.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id: accountId } = await params;
  const account = await getAccountForUser(userId, accountId);
  if (!account) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  // Accept the report either nested ({ report: {...} }) or flat on the body.
  const report = normalizeReport(b.report ?? b);
  if (!hasNarrative(report)) {
    return NextResponse.json(
      { error: "Tell Critiq what happened on the call first." },
      { status: 400 },
    );
  }

  // Phase 34d — optionally link the recorded call. When the rep attaches a
  // recording, the coaching step (Phase 21) consumes its objective three-pillar
  // score. The link is OPTIONAL — most beta debriefs are of un-recorded calls and
  // omit it. When present it MUST be the rep's OWN recording AND already assigned
  // to THIS account (the assignment is the access boundary, and it guarantees the
  // score the coaching snapshots actually belongs to this account's call). An
  // explicitly-supplied-but-invalid id is a 400 (don't silently drop a link the
  // rep asked for); omitting it keeps the un-recorded path exactly as before.
  let recordingId: string | null = null;
  if (typeof b.recordingId === "string" && b.recordingId.length > 0) {
    const recording = await getRecordingForUser(userId, b.recordingId);
    if (!recording || recording.accountId !== accountId) {
      return NextResponse.json(
        { error: "That recording isn't available for this account." },
        { status: 400 },
      );
    }
    recordingId = recording.id;
  }

  const outcome = await generateDebriefForAccount({
    userId,
    accountId,
    report,
    recordingId,
  });

  if (outcome.status === "not-found") {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }
  if (outcome.status === "failed") {
    return NextResponse.json(
      {
        error: "Couldn't write up the debrief. Try again.",
        detail: outcome.error,
      },
      { status: 502 },
    );
  }

  // Phase 23 — semantic memory. A completed debrief is new episodic material, so
  // regenerate the SHARED account summary. Fire it AFTER the response (the rep
  // shouldn't wait on a second Claude call); the /api/cron/consolidate-accounts
  // sweeper is the guaranteed net if this best-effort run is frozen by the platform.
  // Pass the account meta we already have so the runner skips a re-fetch. The runner
  // catches its own errors (marks the row failed); guard the callback regardless.
  after(async () => {
    try {
      await runConsolidationForAccount(accountId, {
        account: { name: account.name, stage: account.stage },
      });
    } catch (e) {
      console.error(`[debrief] consolidation trigger failed for ${accountId}:`, e);
    }
  });

  // Phase 24 — rep semantic memory. Also a best-effort post-response trigger. Unlike the
  // account summary (every debrief), the rep profile regenerates only when the rep
  // crosses a new multiple of 10 completed debriefs; runRepConsolidation checks that and
  // no-ops cheaply (no Claude call) otherwise. The /api/cron/consolidate-reps sweeper is
  // the guaranteed net. The runner catches its own errors; guard the callback regardless.
  after(async () => {
    try {
      await runRepConsolidation(userId);
    } catch (e) {
      console.error(`[debrief] rep consolidation trigger failed for ${userId}:`, e);
    }
  });

  // Return the debrief just generated (by id) — not "latest" — so concurrent
  // debriefs in two tabs can't return each other's row.
  const debrief = await getDebriefForUser(userId, outcome.debriefId);
  return NextResponse.json({ ok: true, debrief });
}

/** Read the rep's most recent completed debrief for this account (404 if none yet). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id: accountId } = await params;
  const account = await getAccountForUser(userId, accountId);
  if (!account) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  const debrief = await getLatestDebriefForAccount(userId, accountId);
  if (!debrief) {
    return NextResponse.json({ error: "No debrief yet." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, debrief });
}
