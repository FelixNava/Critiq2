import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { purgeUserAccount } from "@/lib/account/delete";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * Phase 37c — permanently delete the signed-in rep's own account. Destructive +
 * irreversible. Gated by: an authenticated session (you can only delete yourself),
 * a typed-email confirmation that must match the session email, and a beta guard
 * against admin self-deletion (a self-delete could lock out the only admin).
 */
export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  const email = session?.user?.email ?? "";
  const role =
    (session?.user as { role?: string } | undefined)?.role ?? "rep";

  if (!userId) return json({ error: "Not signed in." }, 401);

  if (role === "admin") {
    return json(
      { error: "Admin accounts can't be self-deleted during the beta." },
      403,
    );
  }

  let confirmEmail = "";
  try {
    const body = (await request.json()) as { confirmEmail?: unknown };
    confirmEmail =
      typeof body.confirmEmail === "string" ? body.confirmEmail : "";
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  if (
    !email ||
    confirmEmail.trim().toLowerCase() !== email.trim().toLowerCase()
  ) {
    return json(
      { error: "That doesn't match your email. Type it exactly to confirm." },
      400,
    );
  }

  try {
    await purgeUserAccount(userId);
  } catch (err) {
    console.error(`[account-delete] failed for user ${userId}`, err);
    return json({ error: "Couldn't delete your account. Try again." }, 500);
  }

  return json({ ok: true });
}
