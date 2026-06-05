import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { accountsTbl, accountRepJoins, contacts } from "@/db/schema";

/**
 * Sales stages an account can be in. `value` is what's stored; `label` is the
 * rep-facing copy (no dev jargon). Order is the natural pipeline progression.
 */
export const ACCOUNT_STAGES = [
  { value: "prospecting", label: "Prospecting" },
  { value: "active", label: "Active" },
  { value: "at_risk", label: "At risk" },
  { value: "won", label: "Won" },
  { value: "dormant", label: "Dormant" },
] as const;

export type AccountStage = (typeof ACCOUNT_STAGES)[number]["value"];

const STAGE_VALUES = new Set<string>(ACCOUNT_STAGES.map((s) => s.value));
export const DEFAULT_STAGE: AccountStage = "prospecting";

export function isAccountStage(v: unknown): v is AccountStage {
  return typeof v === "string" && STAGE_VALUES.has(v);
}

export function stageLabel(value: string): string {
  return ACCOUNT_STAGES.find((s) => s.value === value)?.label ?? value;
}

export const MAX_ACCOUNT_NAME = 200;

export type AccountListItem = {
  id: string;
  name: string;
  stage: string;
  updatedAt: Date;
  role: string;
  contactCount: number;
};

/**
 * List the (non-deleted) accounts a rep is assigned to, newest activity first.
 * Joined via `account_rep_joins`; `contactCount` counts non-deleted contacts.
 * Deliberately omits the (potentially large) shared `summary` text — the list
 * view doesn't render it; the per-account view (later phase) fetches it.
 */
export async function listAccountsForUser(
  userId: string,
): Promise<AccountListItem[]> {
  const rows = await db
    .select({
      id: accountsTbl.id,
      name: accountsTbl.name,
      stage: accountsTbl.stage,
      updatedAt: accountsTbl.updatedAt,
      role: accountRepJoins.role,
      contactCount: sql<number>`(
        select count(*)::int from ${contacts}
        where ${contacts.accountId} = ${accountsTbl.id}
          and ${contacts.deletedAt} is null
      )`,
    })
    .from(accountRepJoins)
    .innerJoin(accountsTbl, eq(accountRepJoins.accountId, accountsTbl.id))
    .where(
      and(eq(accountRepJoins.userId, userId), isNull(accountsTbl.deletedAt)),
    )
    .orderBy(desc(accountsTbl.updatedAt));

  return rows;
}

/**
 * Create an account and assign the creating rep as its owner. Returns the new
 * account id. The account is shared (intelligence is account-scoped), but the
 * creator is linked as `owner` so it appears in their list immediately.
 *
 * Both writes run in a single `db.batch` so a failed join insert can never
 * leave an orphan account that's invisible to every rep — neon-http runs a
 * batch as one atomic transaction (the driver has no interactive `transaction`
 * support). The id is generated up front so the two inserts don't depend on
 * each other's results.
 */
export async function createAccountForUser(
  userId: string,
  input: { name: string; stage: AccountStage },
): Promise<string> {
  const accountId = crypto.randomUUID();

  await db.batch([
    db.insert(accountsTbl).values({
      id: accountId,
      name: input.name,
      stage: input.stage,
      createdBy: userId,
    }),
    db
      .insert(accountRepJoins)
      .values({ accountId, userId, role: "owner" })
      .onConflictDoNothing(),
  ]);

  return accountId;
}
