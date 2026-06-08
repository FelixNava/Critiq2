import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createRecording } from "@/lib/recordings";
import { getAccountForUser } from "@/lib/accounts";

export const dynamic = "force-dynamic";

/**
 * Begin a capture session. Body is optional: a standalone dev recording has no
 * account; if an accountId is given the rep must have access to it (ownership =
 * the access boundary). Returns the new recordingId the client uses to scope its
 * chunk uploads.
 */
export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: { accountId?: unknown } = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  let accountId: string | null = null;
  if (typeof body.accountId === "string" && body.accountId.length > 0) {
    const account = await getAccountForUser(userId, body.accountId);
    if (!account) {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }
    accountId = body.accountId;
  }

  try {
    const recordingId = await createRecording(userId, accountId);
    return NextResponse.json({ recordingId });
  } catch (err) {
    console.error("recording start failed", err);
    return NextResponse.json(
      { error: "Something went wrong. Try again." },
      { status: 500 },
    );
  }
}
