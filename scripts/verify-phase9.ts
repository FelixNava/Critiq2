/**
 * Phase 9 data-layer verification. Exercises the REAL app functions
 * (createAccountForUser / listAccountsForUser) against the Neon dev DB — no
 * re-implemented logic. Creates a throwaway user, runs the helpers, asserts the
 * results, then cleans up. Run: pnpm tsx scripts/verify-phase9.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { eq } from "drizzle-orm";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined)
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

async function main() {
  const { db } = await import("../src/db/index");
  const { users, accountsTbl, accountRepJoins } = await import(
    "../src/db/schema"
  );
  const { createAccountForUser, listAccountsForUser } = await import(
    "../src/lib/accounts"
  );

  const email = `phase9-verify-${crypto.randomUUID()}@example.invalid`;
  const [u] = await db
    .insert(users)
    .values({ email, name: "Phase9 Verify" })
    .returning({ id: users.id });
  const userId = u.id;
  const fails: string[] = [];
  const ok = (cond: boolean, msg: string) => {
    console.log(`${cond ? "✓" : "✗"} ${msg}`);
    if (!cond) fails.push(msg);
  };

  try {
    // Empty list before any account.
    const before = await listAccountsForUser(userId);
    ok(before.length === 0, "new user has zero accounts");

    // Create two accounts via the real helper.
    const id1 = await createAccountForUser(userId, {
      name: "Riverside Contractors",
      stage: "active",
    });
    const id2 = await createAccountForUser(userId, {
      name: "Acme Paint Supply",
      stage: "prospecting",
    });
    ok(!!id1 && !!id2 && id1 !== id2, "two distinct account ids returned");

    // List reflects both, owner role, zero contacts.
    const after = await listAccountsForUser(userId);
    ok(after.length === 2, "list returns both accounts");
    const a1 = after.find((a) => a.id === id1);
    ok(a1?.role === "owner", "creator is linked as owner");
    ok(a1?.stage === "active", "stage persisted");
    ok(a1?.contactCount === 0, "contactCount is 0 for a fresh account");

    // The join row exists for this user+account.
    const joins = await db
      .select()
      .from(accountRepJoins)
      .where(eq(accountRepJoins.userId, userId));
    ok(joins.length === 2, "two account_rep_joins rows for the user");

    // Soft delete hides the account from the list.
    await db
      .update(accountsTbl)
      .set({ deletedAt: new Date() })
      .where(eq(accountsTbl.id, id1));
    const afterDelete = await listAccountsForUser(userId);
    ok(
      afterDelete.length === 1 && afterDelete[0].id === id2,
      "soft-deleted account is excluded from the list",
    );

    // Cleanup: hard-delete the accounts (cascade removes joins) + the user.
    await db.delete(accountsTbl).where(eq(accountsTbl.id, id1));
    await db.delete(accountsTbl).where(eq(accountsTbl.id, id2));
    await db.delete(users).where(eq(users.id, userId));
    console.log("✓ cleanup complete");
  } catch (e) {
    console.error("PROBE ERROR:", e);
    fails.push("probe threw");
    // Best-effort cleanup.
    try {
      await db.delete(users).where(eq(users.id, userId));
    } catch {}
  }

  if (fails.length) {
    console.error(`\n✗ ${fails.length} assertion(s) failed.`);
    process.exit(1);
  }
  console.log("\n✓ Phase 9 data-layer verification PASSED.");
}

main();
