import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDebriefForUser, setDebriefRating } from "@/lib/debrief/store";

export const dynamic = "force-dynamic";

/**
 * Update a debrief the rep owns: leave a 1–5 usefulness rating (the PRD beta
 * metric). The debrief must belong to this rep AND this account, and be completed
 * (a rating only makes sense on a finished debrief).
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
  const existing = await getDebriefForUser(userId, debriefId);
  // Match BOTH segments: the debrief must be the rep's AND on this account.
  if (!existing || existing.accountId !== accountId) {
    return NextResponse.json({ error: "Debrief not found." }, { status: 404 });
  }
  if (existing.status !== "completed") {
    return NextResponse.json(
      { error: "This debrief isn't ready yet." },
      { status: 409 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  if (b.usefulnessRating === undefined) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }
  const rating = Number(b.usefulnessRating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json(
      { error: "Rating must be a whole number from 1 to 5." },
      { status: 400 },
    );
  }

  const debrief = await setDebriefRating(userId, debriefId, rating);
  return NextResponse.json({ ok: true, debrief });
}
