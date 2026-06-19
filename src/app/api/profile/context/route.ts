import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  MAX_REP_CONTEXT,
  getRepContext,
  normalizeContext,
  setRepContext,
} from "@/lib/context";

export const dynamic = "force-dynamic";

/** Read the signed-in rep's free-text context (Phase 35a). */
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const context = await getRepContext(userId);
  return NextResponse.json({ ok: true, context });
}

/**
 * Save (or clear) the rep's free-text context. An empty/whitespace value clears it.
 * Rep-private — the row is keyed to the signed-in user.
 */
export async function PUT(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const raw = (body ?? {}) as Record<string, unknown>;
  const context = normalizeContext(raw.context, MAX_REP_CONTEXT);

  await setRepContext(userId, context);
  return NextResponse.json({ ok: true, context });
}
