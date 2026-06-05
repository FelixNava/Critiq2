import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { repIntakeResponses, repIntakeProgress } from "@/db/schema";
import { getIntakeProgress, type IntakeDimension } from "@/lib/intake";

export const dynamic = "force-dynamic";

const DEAL_STALL = new Set(["push", "pause", "diagnose"]);
const PIPELINE_METHOD = new Set(["crm", "memory", "hybrid"]);
const EDGE_SOURCE = new Set(["news", "relationships", "vendor"]);
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
    salesPsychology?: { dealStall?: unknown; stallUnblock?: unknown };
    operationalHabits?: { pipelineMethod?: unknown; accountHabit?: unknown };
    marketIntelligence?: { edgeSource?: unknown; bestIntel?: unknown };
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const dealStall = body.salesPsychology?.dealStall;
  if (typeof dealStall !== "string" || !DEAL_STALL.has(dealStall)) {
    return NextResponse.json(
      { error: "Choose what you do when a deal stalls." },
      { status: 400 },
    );
  }

  const pipelineMethod = body.operationalHabits?.pipelineMethod;
  if (typeof pipelineMethod !== "string" || !PIPELINE_METHOD.has(pipelineMethod)) {
    return NextResponse.json(
      { error: "Choose how you run your pipeline." },
      { status: 400 },
    );
  }

  const edgeSource = body.marketIntelligence?.edgeSource;
  if (typeof edgeSource !== "string" || !EDGE_SOURCE.has(edgeSource)) {
    return NextResponse.json(
      { error: "Choose how you keep an edge on your accounts." },
      { status: 400 },
    );
  }

  const stallUnblock = freeText(body.salesPsychology?.stallUnblock);
  const accountHabit = freeText(body.operationalHabits?.accountHabit);
  const bestIntel = freeText(body.marketIntelligence?.bestIntel);
  if (stallUnblock.tooLong || accountHabit.tooLong || bestIntel.tooLong) {
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
      dimension: "sales_psychology",
      questionKey: "deal_stall_instinct",
      answer: dealStall,
    },
    {
      dimension: "sales_psychology",
      questionKey: "stall_unblock",
      answer: stallUnblock.value,
    },
    {
      dimension: "operational_habits",
      questionKey: "pipeline_method",
      answer: pipelineMethod,
    },
    {
      dimension: "operational_habits",
      questionKey: "account_habit",
      answer: accountHabit.value,
    },
    {
      dimension: "market_intelligence",
      questionKey: "edge_source",
      answer: edgeSource,
    },
    {
      dimension: "market_intelligence",
      questionKey: "best_intel",
      answer: bestIntel.value,
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

    for (const dimension of [
      "sales_psychology",
      "operational_habits",
      "market_intelligence",
    ] as const) {
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
