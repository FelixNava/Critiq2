import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { MAX_OBJECTIVE } from "@/lib/precall/objective";
import {
  getBriefForUser,
  setBriefObjective,
  setBriefRating,
} from "@/lib/precall/store";

export const dynamic = "force-dynamic";

/**
 * Update a brief the rep owns: accept/override the in-force objective and/or leave
 * a 1–5 usefulness rating. Overriding Critiq's recommendation flips the source to
 * 'rep' and records the deviation (handled in setBriefObjective). At least one of
 * `objective` / `usefulnessRating` must be present.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; briefId: string }> },
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { briefId } = await params;
  const existing = await getBriefForUser(userId, briefId);
  if (!existing) {
    return NextResponse.json({ error: "Brief not found." }, { status: 404 });
  }
  // Objective/rating only make sense on a finished brief — never mutate a
  // processing/failed row (it has no diagnosis and, for signal mode, no
  // recommendation to override).
  if (existing.status !== "completed") {
    return NextResponse.json(
      { error: "This brief isn't ready yet." },
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

  const hasObjective = typeof b.objective === "string";
  const hasRating = b.usefulnessRating !== undefined;
  if (!hasObjective && !hasRating) {
    return NextResponse.json(
      { error: "Nothing to update." },
      { status: 400 },
    );
  }

  if (hasObjective) {
    const objective = (b.objective as string).trim();
    if (!objective) {
      return NextResponse.json(
        { error: "Objective can't be empty." },
        { status: 400 },
      );
    }
    if (objective.length > MAX_OBJECTIVE) {
      return NextResponse.json(
        { error: `Objective is too long (max ${MAX_OBJECTIVE} characters).` },
        { status: 400 },
      );
    }
    await setBriefObjective(userId, briefId, objective);
  }

  if (hasRating) {
    const rating = Number(b.usefulnessRating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return NextResponse.json(
        { error: "Rating must be a whole number from 1 to 5." },
        { status: 400 },
      );
    }
    await setBriefRating(userId, briefId, rating);
  }

  const brief = await getBriefForUser(userId, briefId);
  return NextResponse.json({ ok: true, brief });
}
