import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRecordingForUser, setRecordingAccount } from "@/lib/recordings";
import { getAccountForUser } from "@/lib/accounts";

export const dynamic = "force-dynamic";

const MAX_TITLE = 200;

/**
 * Manually assign a recording to an account (Phase 34c) — or re-assign it, or
 * clear it (accountId: null). Double-guarded: the rep must OWN the recording
 * (getRecordingForUser) AND, when assigning, have ACCESS to the target account
 * (getAccountForUser, the assignment = the access boundary). An optional `title`
 * lets the rep label the recording at the same time. Re-assignment is allowed.
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

  const { id: recordingId } = await params;
  const recording = await getRecordingForUser(userId, recordingId);
  if (!recording) {
    return NextResponse.json({ error: "Recording not found." }, { status: 404 });
  }

  let body: { accountId?: unknown; title?: unknown } = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  // accountId must be explicitly present: a non-empty string to assign, or null
  // to clear. (Omitting it is ambiguous → 400, so a title-only edit can't
  // silently wipe the assignment.)
  let accountId: string | null;
  if (body.accountId === null) {
    accountId = null;
  } else if (typeof body.accountId === "string" && body.accountId.length > 0) {
    const account = await getAccountForUser(userId, body.accountId);
    if (!account) {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }
    accountId = body.accountId;
  } else {
    return NextResponse.json(
      { error: "An account is required." },
      { status: 400 },
    );
  }

  let title: string | null | undefined;
  if (typeof body.title === "string") {
    const trimmed = body.title.trim().slice(0, MAX_TITLE);
    title = trimmed.length > 0 ? trimmed : null;
  }

  try {
    const ok = await setRecordingAccount(userId, recordingId, accountId, title);
    if (!ok) {
      return NextResponse.json(
        { error: "Recording not found." },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, accountId });
  } catch (err) {
    console.error("recording assign-account failed", err);
    return NextResponse.json(
      { error: "Something went wrong. Try again." },
      { status: 500 },
    );
  }
}
