import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getAccountForUser } from "@/lib/accounts";
import { generateBriefForAccount } from "@/lib/precall/generate";
import {
  MAX_NARRATION,
  MAX_OBJECTIVE,
  nextInteractionNumber,
  resolveObjectiveMode,
} from "@/lib/precall/objective";
import {
  getAccountInteractionCount,
  getBriefForUser,
  getLatestBriefForAccount,
} from "@/lib/precall/store";

export const dynamic = "force-dynamic";
// One Claude round-trip (adaptive thinking over a short prompt). The rep is
// waiting, so this is synchronous; give it headroom but well under the gateway cap.
export const maxDuration = 120;

/**
 * Generate a pre-call brief for a rep-owned account. Determines the objective mode
 * by the HARD RULE (rep sets on interactions 1–2, Critiq recommends on 3+) before
 * generating — on rep mode an objective is required. Returns the generated brief.
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

  const narration = typeof b.narration === "string" ? b.narration.trim() : "";
  if (!narration) {
    return NextResponse.json(
      { error: "Add a few notes about the account and this call first." },
      { status: 400 },
    );
  }
  if (narration.length > MAX_NARRATION) {
    return NextResponse.json(
      { error: `Notes are too long (max ${MAX_NARRATION} characters).` },
      { status: 400 },
    );
  }

  // The objective rule: count this account's interactions, then decide who sets it.
  const priorInteractions = await getAccountInteractionCount(accountId);
  const interactionNumber = nextInteractionNumber(priorInteractions);
  const mode = resolveObjectiveMode(interactionNumber);

  const rawObjective =
    typeof b.objective === "string" ? b.objective.trim() : "";
  if (rawObjective.length > MAX_OBJECTIVE) {
    return NextResponse.json(
      { error: `Objective is too long (max ${MAX_OBJECTIVE} characters).` },
      { status: 400 },
    );
  }
  if (mode === "rep" && !rawObjective) {
    return NextResponse.json(
      {
        error:
          "Set your objective for this call — Critiq starts recommending objectives once it knows the account.",
        objectiveMode: mode,
        interactionNumber,
      },
      { status: 400 },
    );
  }

  const outcome = await generateBriefForAccount(
    {
      userId,
      accountId,
      narration,
      repObjective: mode === "rep" ? rawObjective : null,
    },
    { interactionCount: priorInteractions },
  );

  if (outcome.status === "not-found") {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }
  if (outcome.status === "failed") {
    return NextResponse.json(
      { error: "Couldn't prepare the brief. Try again.", detail: outcome.error },
      { status: 502 },
    );
  }

  // Return the brief just generated (by id) — not "latest" — so concurrent preps
  // in two tabs can't return each other's row.
  const brief = await getBriefForUser(userId, outcome.briefId);
  return NextResponse.json({ ok: true, outcome, brief });
}

/** Read the rep's most recent brief for this account (404 if none yet). */
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

  const brief = await getLatestBriefForAccount(userId, accountId);
  if (!brief) {
    return NextResponse.json({ error: "No brief yet." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, brief });
}
