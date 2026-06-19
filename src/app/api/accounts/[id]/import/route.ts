import { NextResponse, after } from "next/server";
import { auth } from "@/auth";
import { getAccountForUser } from "@/lib/accounts";
import { generateDebriefForAccount } from "@/lib/debrief/generate";
import { normalizeImport } from "@/lib/debrief/import";
import { getDebriefForUser } from "@/lib/debrief/store";
import { runConsolidationForAccount } from "@/lib/consolidation/runner";
import { runRepConsolidation } from "@/lib/repconsolidation/runner";

export const dynamic = "force-dynamic";
// Like the debrief route: the structuring call is synchronous (the rep waits), then
// account + rep consolidation run post-response via after(). after() shares this
// function's budget, so allow headroom; the cron sweepers are the net.
export const maxDuration = 300;

/**
 * Import a past call for a rep-owned account (Phase 35b). The pasted notes/transcript
 * are structured by the SAME Phase 20 debrief generator into a completed debrief, so it
 * feeds consolidation (23/24) + working memory (25) with no new pipeline. Returns the
 * structured debrief.
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

  const parsed = normalizeImport({ rawText: b.rawText, about: b.about });
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const outcome = await generateDebriefForAccount({
    userId,
    accountId,
    report: parsed.report,
  });

  if (outcome.status === "not-found") {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }
  if (outcome.status === "failed") {
    return NextResponse.json(
      {
        error: "Couldn't process that import. Try again.",
        detail: outcome.error,
      },
      { status: 502 },
    );
  }

  // Same best-effort post-response consolidation triggers as a live debrief: a new
  // completed debrief is new episodic material for the account (Phase 23) and may push
  // the rep across the next every-10 interval (Phase 24). The cron sweepers are the net.
  after(async () => {
    try {
      await runConsolidationForAccount(accountId, {
        account: { name: account.name, stage: account.stage },
      });
    } catch (e) {
      console.error(`[import] consolidation trigger failed for ${accountId}:`, e);
    }
  });
  after(async () => {
    try {
      await runRepConsolidation(userId);
    } catch (e) {
      console.error(`[import] rep consolidation trigger failed for ${userId}:`, e);
    }
  });

  const debrief = await getDebriefForUser(userId, outcome.debriefId);
  return NextResponse.json({ ok: true, debrief });
}
