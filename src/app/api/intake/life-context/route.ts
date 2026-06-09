import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { repIntakeResponses, repIntakeProgress } from "@/db/schema";
import {
  getIntakeProgress,
  getLifeContextGate,
  isSession1Complete,
  isSession2Complete,
  freeText,
  type IntakeDimension,
} from "@/lib/intake";

export const dynamic = "force-dynamic";

const LIFE_SEASON = new Set(["building", "steady", "stretched", "reset"]);

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // Trust-gate: Life Context is locked until the account is old enough.
  // Enforced here on the server, not just hidden in the UI.
  const gate = await getLifeContextGate(userId);
  if (!gate) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!gate.unlocked) {
    return NextResponse.json(
      { error: "This step isn't available yet." },
      { status: 403 },
    );
  }

  // Prerequisite: the earlier intake sessions must be done first. The page
  // guards this too, but the API is the real boundary — enforce it here so a
  // direct POST can't record life_context out of order (which would leave the
  // dashboard showing contradictory states).
  const priorProgress = await getIntakeProgress(userId);
  if (
    !isSession1Complete(priorProgress) ||
    !isSession2Complete(priorProgress)
  ) {
    return NextResponse.json(
      { error: "Finish the earlier steps first." },
      { status: 409 },
    );
  }

  let body: {
    lifeContext?: { lifeSeason?: unknown; outsideContext?: unknown };
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const lifeSeason = body.lifeContext?.lifeSeason;
  if (typeof lifeSeason !== "string" || !LIFE_SEASON.has(lifeSeason)) {
    return NextResponse.json(
      { error: "Pick the season that fits you best." },
      { status: 400 },
    );
  }

  const outsideContext = freeText(body.lifeContext?.outsideContext);
  if (outsideContext.tooLong) {
    return NextResponse.json(
      { error: "Response is too long." },
      { status: 400 },
    );
  }

  const responses: {
    dimension: IntakeDimension;
    questionKey: string;
    answer: unknown;
  }[] = [
    {
      dimension: "life_context",
      questionKey: "life_season",
      answer: lifeSeason,
    },
    {
      dimension: "life_context",
      questionKey: "outside_context",
      answer: outsideContext.value,
    },
  ];

  try {
    for (const r of responses) {
      await db
        .insert(repIntakeResponses)
        .values({
          userId,
          dimension: r.dimension,
          questionKey: r.questionKey,
          answer: r.answer,
        })
        .onConflictDoUpdate({
          target: [repIntakeResponses.userId, repIntakeResponses.questionKey],
          set: {
            answer: sql`excluded.answer`,
            dimension: sql`excluded.dimension`,
            updatedAt: sql`now()`,
          },
        });
    }

    await db
      .insert(repIntakeProgress)
      .values({ userId, dimension: "life_context" })
      .onConflictDoUpdate({
        target: [repIntakeProgress.userId, repIntakeProgress.dimension],
        // Preserve completedAt; only bump updatedAt.
        set: { updatedAt: sql`now()` },
      });
  } catch {
    return NextResponse.json(
      { error: "Something went wrong. Try again." },
      { status: 500 },
    );
  }

  const progress = await getIntakeProgress(userId);
  return NextResponse.json({ ok: true, progress });
}
