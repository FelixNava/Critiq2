import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sendInterruptionPush } from "@/lib/push/subscriptions";

export const dynamic = "force-dynamic";

/**
 * Send the BRANDING-ONLY interruption push to the signed-in rep's OWN devices.
 * Called by the client interruption monitor when capture is interrupted, to
 * reach a backgrounded PWA where the in-page channels (chime / banner / tab
 * flash) can't run. A rep can only notify themselves (userId from the session),
 * so this is not an outbound-abuse surface.
 *
 * Honest limitation (documented for the device gate): client-detected, so it
 * only fires while the page still gets a tick to make this request. The durable
 * server-side gap detector that can push to a fully-suspended device is a later
 * phase; this wires the full, working push path it will reuse.
 */
export async function POST() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await sendInterruptionPush(userId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("push notify failed", err);
    return NextResponse.json(
      { error: "Something went wrong." },
      { status: 500 },
    );
  }
}
