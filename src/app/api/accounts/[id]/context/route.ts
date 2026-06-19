import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  MAX_ACCOUNT_CONTEXT,
  getAccountContextForUser,
  normalizeContext,
  setAccountContextForUser,
} from "@/lib/context";

export const dynamic = "force-dynamic";

/** Read this account's shared context (Phase 35a). 404 if the rep isn't assigned. */
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
  // getAccountContextForUser returns null both when there's no context AND when the
  // rep isn't assigned; distinguish "not assigned" is unnecessary here (the page
  // already gates on getAccountForUser), so just return the value (null = none).
  const context = await getAccountContextForUser(userId, accountId);
  return NextResponse.json({ ok: true, context });
}

/**
 * Save (or clear) this account's SHARED context. Gated by the account assignment
 * (the rep must be on the account). An empty/whitespace value clears it. Returns 404
 * when the rep isn't assigned to the account (the write is refused).
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id: accountId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const raw = (body ?? {}) as Record<string, unknown>;
  const context = normalizeContext(raw.context, MAX_ACCOUNT_CONTEXT);

  const ok = await setAccountContextForUser(userId, accountId, context);
  if (!ok) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, context });
}
