import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  createAccountForUser,
  isAccountStage,
  DEFAULT_STAGE,
  MAX_ACCOUNT_NAME,
} from "@/lib/accounts";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: { name?: unknown; stage?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length === 0) {
    return NextResponse.json(
      { error: "Give the account a name." },
      { status: 400 },
    );
  }
  if (name.length > MAX_ACCOUNT_NAME) {
    return NextResponse.json(
      { error: "That name is too long." },
      { status: 400 },
    );
  }

  // Stage is optional on create; default to the first pipeline stage.
  const stage =
    body.stage === undefined || body.stage === null
      ? DEFAULT_STAGE
      : body.stage;
  if (!isAccountStage(stage)) {
    return NextResponse.json({ error: "Pick a valid stage." }, { status: 400 });
  }

  try {
    const id = await createAccountForUser(userId, { name, stage });
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    console.error("account create failed", err);
    return NextResponse.json(
      { error: "Something went wrong. Try again." },
      { status: 500 },
    );
  }
}
