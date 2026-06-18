import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getAccountForUser } from "@/lib/accounts";
import {
  getCoachingForUser,
  getLatestCoachingForDebrief,
  setCoachingRating,
} from "@/lib/coaching/store";
import { generateCoachingForDebrief } from "@/lib/coaching/generate";
import { getDebriefForUser } from "@/lib/debrief/store";

export const dynamic = "force-dynamic";
// One Claude round-trip (adaptive thinking over the debrief + score). The rep is
// waiting, so this is synchronous; give it headroom but well under the gateway cap.
export const maxDuration = 120;

/**
 * Generate coaching from a completed debrief the rep owns. The debrief (and its
 * linked score, if any) is the input; coaching never re-derives the recap or the
 * score. Returns the generated coaching.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; debriefId: string }> },
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id: accountId, debriefId } = await params;

  const outcome = await generateCoachingForDebrief({
    userId,
    accountId,
    debriefId,
  });

  if (outcome.status === "not-found") {
    return NextResponse.json({ error: "Debrief not found." }, { status: 404 });
  }
  if (outcome.status === "debrief-not-ready") {
    return NextResponse.json(
      { error: "Write up the debrief first." },
      { status: 409 },
    );
  }
  if (outcome.status === "failed") {
    return NextResponse.json(
      {
        error: "Couldn't put together your coaching. Try again.",
        detail: outcome.error,
      },
      { status: 502 },
    );
  }

  const coaching = await getCoachingForUser(userId, outcome.coachingId);
  return NextResponse.json({ ok: true, coaching });
}

/** Read the rep's most recent coaching for this debrief (404 if none yet). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; debriefId: string }> },
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id: accountId, debriefId } = await params;
  // Ownership boundary: the account must be the rep's and the debrief must be theirs
  // AND on this account.
  const account = await getAccountForUser(userId, accountId);
  if (!account) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }
  const debrief = await getDebriefForUser(userId, debriefId);
  if (!debrief || debrief.accountId !== accountId) {
    return NextResponse.json({ error: "Debrief not found." }, { status: 404 });
  }

  const coaching = await getLatestCoachingForDebrief(userId, debriefId);
  if (!coaching) {
    return NextResponse.json({ error: "No coaching yet." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, coaching });
}

/**
 * Rate coaching the rep owns (1–5 usefulness — the PRD beta metric). Body:
 * `{ coachingId, usefulnessRating }`. The coaching must be the rep's AND match BOTH
 * URL segments (account + debrief), so the segments are load-bearing.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; debriefId: string }> },
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id: accountId, debriefId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const coachingId = typeof b.coachingId === "string" ? b.coachingId : "";
  if (!coachingId) {
    return NextResponse.json({ error: "Missing coachingId." }, { status: 400 });
  }

  const existing = await getCoachingForUser(userId, coachingId);
  if (
    !existing ||
    existing.debriefId !== debriefId ||
    existing.accountId !== accountId
  ) {
    return NextResponse.json({ error: "Coaching not found." }, { status: 404 });
  }
  if (existing.status !== "completed") {
    return NextResponse.json(
      { error: "This coaching isn't ready yet." },
      { status: 409 },
    );
  }

  const rating = Number(b.usefulnessRating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json(
      { error: "Rating must be a whole number from 1 to 5." },
      { status: 400 },
    );
  }

  const coaching = await setCoachingRating(userId, coachingId, rating);
  return NextResponse.json({ ok: true, coaching });
}
