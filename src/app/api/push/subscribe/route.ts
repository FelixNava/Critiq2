import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { parseSubscription, saveSubscription } from "@/lib/push/subscriptions";

export const dynamic = "force-dynamic";

/**
 * Register (or refresh) a Web Push subscription for the signed-in rep. Body is
 * the browser PushSubscription JSON. Idempotent on the endpoint.
 */
export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const sub = parseSubscription((body as { subscription?: unknown })?.subscription ?? body);
  if (!sub) {
    return NextResponse.json(
      { error: "Invalid subscription." },
      { status: 400 },
    );
  }

  const userAgent = req.headers.get("user-agent");
  try {
    await saveSubscription(userId, { ...sub, userAgent });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("push subscribe failed", err);
    return NextResponse.json(
      { error: "Something went wrong. Try again." },
      { status: 500 },
    );
  }
}
