/**
 * Phase 10 data-layer verification. Exercises the REAL app functions
 * (getAccountForUser / getLearningProgress) against the Neon dev DB — no
 * re-implemented logic. Creates two throwaway users + one account, asserts the
 * detail fetch, its access boundary, contact ordering, and the cold-start
 * learning model, then cleans up. Run: pnpm tsx scripts/verify-phase10.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { eq, inArray } from "drizzle-orm";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined)
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

async function main() {
  const { db } = await import("../src/db/index");
  const { users, accountsTbl, contacts } = await import("../src/db/schema");
  const { createAccountForUser, getAccountForUser, getLearningProgress } =
    await import("../src/lib/accounts");

  const mkEmail = () => `phase10-verify-${crypto.randomUUID()}@example.invalid`;
  const [owner] = await db
    .insert(users)
    .values({ email: mkEmail(), name: "Phase10 Owner" })
    .returning({ id: users.id });
  const [outsider] = await db
    .insert(users)
    .values({ email: mkEmail(), name: "Phase10 Outsider" })
    .returning({ id: users.id });

  const fails: string[] = [];
  const ok = (cond: boolean, msg: string) => {
    console.log(`${cond ? "✓" : "✗"} ${msg}`);
    if (!cond) fails.push(msg);
  };

  let accountId = "";
  try {
    // --- Pure cold-start learning model (no DB needed) ---
    const cold = getLearningProgress(0);
    ok(
      cold.loggedCalls === 0 && cold.percent === 0 && cold.isWarm === false,
      "learning model: 0 calls → 0%, not warm",
    );
    const mid = getLearningProgress(5);
    ok(
      mid.percent === 50 && mid.isWarm === false,
      "learning model: 5 calls → 50%, not warm",
    );
    const warm = getLearningProgress(12);
    ok(
      warm.percent === 100 && warm.isWarm === true,
      "learning model: 12 calls → clamped 100%, warm",
    );
    const garbage = getLearningProgress(Number.NaN);
    ok(garbage.percent === 0, "learning model: NaN calls fails safe to 0%");

    // --- Detail fetch ---
    accountId = await createAccountForUser(owner.id, {
      name: "Lakeside Builders",
      stage: "at_risk",
    });

    const detail = await getAccountForUser(owner.id, accountId);
    ok(detail !== null, "owner can fetch the account detail");
    ok(detail?.role === "owner", "detail reports the rep's role (owner)");
    ok(detail?.stage === "at_risk", "detail carries the stage");
    ok(detail?.summary === null, "summary is null at cold start");
    ok(detail?.loggedCalls === 0, "loggedCalls is 0 (no interaction data yet)");
    ok(
      Array.isArray(detail?.contacts) && detail?.contacts.length === 0,
      "detail returns an empty contacts list for a fresh account",
    );

    // --- Access boundary: a rep NOT assigned cannot read the account ---
    const denied = await getAccountForUser(outsider.id, accountId);
    ok(denied === null, "unassigned rep gets null (access boundary holds)");

    // --- Unknown id → null ---
    const missing = await getAccountForUser(owner.id, crypto.randomUUID());
    ok(missing === null, "unknown account id → null");

    // --- Contacts: primary first, then alphabetical ---
    await db.insert(contacts).values([
      { accountId, name: "Zoe Vendor", isPrimary: false },
      { accountId, name: "Amy Buyer", isPrimary: false },
      { accountId, name: "Pat Primary", isPrimary: true },
    ]);
    const withContacts = await getAccountForUser(owner.id, accountId);
    const order = withContacts?.contacts.map((c) => c.name) ?? [];
    ok(
      order.length === 3 &&
        order[0] === "Pat Primary" &&
        order[1] === "Amy Buyer" &&
        order[2] === "Zoe Vendor",
      `contacts ordered primary-first then alphabetical (got: ${order.join(", ")})`,
    );

    // --- Soft-deleted account is not fetchable ---
    await db
      .update(accountsTbl)
      .set({ deletedAt: new Date() })
      .where(eq(accountsTbl.id, accountId));
    const afterDelete = await getAccountForUser(owner.id, accountId);
    ok(afterDelete === null, "soft-deleted account → null");
  } catch (e) {
    console.error("PROBE ERROR:", e);
    fails.push("probe threw");
  } finally {
    // Cleanup: account cascade removes contacts + joins; then the users.
    try {
      if (accountId)
        await db.delete(accountsTbl).where(eq(accountsTbl.id, accountId));
      await db
        .delete(users)
        .where(inArray(users.id, [owner.id, outsider.id]));
      console.log("✓ cleanup complete");
    } catch (e) {
      console.error("cleanup error (non-fatal):", e);
    }
  }

  if (fails.length) {
    console.error(`\n✗ ${fails.length} assertion(s) failed.`);
    process.exit(1);
  }
  console.log("\n✓ Phase 10 data-layer verification PASSED.");
}

main();
