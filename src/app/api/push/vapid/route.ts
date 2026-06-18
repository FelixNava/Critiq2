import { NextResponse } from "next/server";
import { getPublicVapidKey } from "@/lib/push/webpush";

export const dynamic = "force-dynamic";

/**
 * The client needs the public VAPID key to create a push subscription. Exposing
 * it via this route (rather than a NEXT_PUBLIC_* var) means rotating the key is a
 * Vercel env change with no rebuild. Returns { publicKey: null } when push is not
 * configured, so the client can show the "alerts unavailable here" state cleanly.
 */
export async function GET() {
  return NextResponse.json({ publicKey: getPublicVapidKey() });
}
