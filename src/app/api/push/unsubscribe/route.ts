import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { deleteSubscription } from "@/lib/push/subscriptions";

export const dynamic = "force-dynamic";

/**
 * Remove a Web Push subscription for the signed-in rep (e.g. they turned alerts
 * off, or the browser rotated the endpoint). Body: { endpoint }.
 */
export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: { endpoint?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const endpoint = typeof body.endpoint === "string" ? body.endpoint : null;
  if (!endpoint) {
    return NextResponse.json({ error: "Missing endpoint." }, { status: 400 });
  }

  try {
    await deleteSubscription(userId, endpoint);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("push unsubscribe failed", err);
    return NextResponse.json(
      { error: "Something went wrong. Try again." },
      { status: 500 },
    );
  }
}
