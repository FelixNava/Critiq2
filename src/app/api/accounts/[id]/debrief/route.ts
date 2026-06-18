import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getAccountForUser } from "@/lib/accounts";
import { generateDebriefForAccount } from "@/lib/debrief/generate";
import { hasNarrative, normalizeReport } from "@/lib/debrief/reporter";
import {
  getDebriefForUser,
  getLatestDebriefForAccount,
} from "@/lib/debrief/store";

export const dynamic = "force-dynamic";
// One Claude round-trip (adaptive thinking over a short report). The rep is
// waiting, so this is synchronous; give it headroom but well under the gateway cap.
export const maxDuration = 120;

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

  const outcome = await generateDebriefForAccount({
    userId,
    accountId,
    report,
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
