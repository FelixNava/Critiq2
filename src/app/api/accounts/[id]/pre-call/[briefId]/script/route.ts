import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getAccountForUser } from "@/lib/accounts";
import { getBriefForUser } from "@/lib/precall/store";
import { generateScriptForBrief } from "@/lib/script/generate";
import { coerceStyleMode, isStyleMode } from "@/lib/script/style";
import {
  getLatestScriptForBrief,
  getScriptForUser,
  setScriptRating,
} from "@/lib/script/store";

export const dynamic = "force-dynamic";
// One Claude round-trip (adaptive thinking over the brief). The rep is waiting, so
// this is synchronous; give it headroom but well under the gateway cap.
export const maxDuration = 120;

/**
 * Generate a call script from a completed brief the rep owns. Body: optional
 * `styleMode` ('assertive' | 'relational'; defaults to the rep's baseline). The
 * objective + approach come from the brief — the script never re-derives them.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; briefId: string }> },
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id: accountId, briefId } = await params;

  let body: unknown = {};
  try {
    // A body is optional (style mode only); tolerate an empty/invalid one.
    body = (await req.json()) ?? {};
  } catch {
    body = {};
  }
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.styleMode !== undefined && !isStyleMode(b.styleMode)) {
    return NextResponse.json(
      { error: "Pick a valid style mode." },
      { status: 400 },
    );
  }
  const styleMode = coerceStyleMode(b.styleMode);

  const outcome = await generateScriptForBrief({
    userId,
    accountId,
    briefId,
    styleMode,
  });

  if (outcome.status === "not-found") {
    return NextResponse.json({ error: "Brief not found." }, { status: 404 });
  }
  if (outcome.status === "brief-not-ready") {
    return NextResponse.json(
      { error: "Prepare the brief first." },
      { status: 409 },
    );
  }
  if (outcome.status === "no-objective") {
    return NextResponse.json(
      { error: "Set an objective on the brief before generating a script." },
      { status: 409 },
    );
  }
  if (outcome.status === "failed") {
    return NextResponse.json(
      { error: "Couldn't write the script. Try again.", detail: outcome.error },
      { status: 502 },
    );
  }

  const script = await getScriptForUser(userId, outcome.scriptId);
  return NextResponse.json({ ok: true, outcome, script });
}

/** Read the rep's most recent script for this brief (404 if none yet). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; briefId: string }> },
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id: accountId, briefId } = await params;
  // Ownership boundary: the account must be the rep's and the brief must be theirs.
  const account = await getAccountForUser(userId, accountId);
  if (!account) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }
  const brief = await getBriefForUser(userId, briefId);
  if (!brief || brief.accountId !== accountId) {
    return NextResponse.json({ error: "Brief not found." }, { status: 404 });
  }

  const script = await getLatestScriptForBrief(userId, briefId);
  if (!script) {
    return NextResponse.json({ error: "No script yet." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, script });
}

/**
 * Rate a script the rep owns (1–5 usefulness — the PRD's script-adoption metric).
 * Body: `{ scriptId, usefulnessRating }`. Ownership is enforced in setScriptRating.
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

  const { id: accountId, briefId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const scriptId = typeof b.scriptId === "string" ? b.scriptId : "";
  if (!scriptId) {
    return NextResponse.json({ error: "Missing scriptId." }, { status: 400 });
  }

  const existing = await getScriptForUser(userId, scriptId);
  // The script must be the rep's AND match BOTH URL segments (account + brief), so
  // the account segment is load-bearing, consistent with POST/GET.
  if (
    !existing ||
    existing.briefId !== briefId ||
    existing.accountId !== accountId
  ) {
    return NextResponse.json({ error: "Script not found." }, { status: 404 });
  }
  if (existing.status !== "completed") {
    return NextResponse.json(
      { error: "This script isn't ready yet." },
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

  const script = await setScriptRating(userId, scriptId, rating);
  return NextResponse.json({ ok: true, script });
}
