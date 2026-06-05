import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { repIntakeResponses, repIntakeProgress } from "@/db/schema";
import { getIntakeProgress, type IntakeDimension } from "@/lib/intake";

export const dynamic = "force-dynamic";

const MOTIVATORS = new Set([
  "money",
  "winning",
  "freedom",
  "recognition",
  "impact",
  "growth",
]);
const LEAD_OR_LISTEN = new Set(["lead", "listen", "depends"]);
const MAX_FREE_TEXT = 2000;

type FreeText = { value: string | null; tooLong: boolean };

/** Coerce a free-text field: non-string → null, trim, empty → null, flag >2000. */
function freeText(raw: unknown): FreeText {
  if (typeof raw !== "string") return { value: null, tooLong: false };
  const trimmed = raw.trim();
  if (trimmed.length > MAX_FREE_TEXT) return { value: null, tooLong: true };
  return { value: trimmed.length === 0 ? null : trimmed, tooLong: false };
}

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: {
    identity?: { motivatorPriority?: unknown; legacy?: unknown };
    relationships?: { leadOrListen?: unknown; secondMeeting?: unknown };
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const motivatorPriority = body.identity?.motivatorPriority;
  if (
    typeof motivatorPriority !== "string" ||
    !MOTIVATORS.has(motivatorPriority)
  ) {
    return NextResponse.json(
      { error: "Choose a valid motivator." },
      { status: 400 },
    );
  }

  const leadOrListen = body.relationships?.leadOrListen;
  if (typeof leadOrListen !== "string" || !LEAD_OR_LISTEN.has(leadOrListen)) {
    return NextResponse.json(
      { error: "Choose how you approach conversations." },
      { status: 400 },
    );
  }

  const legacy = freeText(body.identity?.legacy);
  const secondMeeting = freeText(body.relationships?.secondMeeting);
  if (legacy.tooLong || secondMeeting.tooLong) {
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
      dimension: "identity",
      questionKey: "motivator_priority",
      answer: motivatorPriority,
    },
    { dimension: "identity", questionKey: "legacy", answer: legacy.value },
    {
      dimension: "relationships",
      questionKey: "lead_or_listen",
      answer: leadOrListen,
    },
    {
      dimension: "relationships",
      questionKey: "second_meeting",
      answer: secondMeeting.value,
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
          target: [
            repIntakeResponses.userId,
            repIntakeResponses.questionKey,
          ],
          set: {
            answer: sql`excluded.answer`,
            dimension: sql`excluded.dimension`,
            updatedAt: sql`now()`,
          },
        });
    }

    for (const dimension of ["identity", "relationships"] as const) {
      await db
        .insert(repIntakeProgress)
        .values({ userId, dimension })
        .onConflictDoUpdate({
          target: [repIntakeProgress.userId, repIntakeProgress.dimension],
          // Preserve completedAt; only bump updatedAt.
          set: { updatedAt: sql`now()` },
        });
    }
  } catch {
    return NextResponse.json(
      { error: "Something went wrong. Try again." },
      { status: 500 },
    );
  }

  const progress = await getIntakeProgress(userId);
  return NextResponse.json({ ok: true, progress });
}
