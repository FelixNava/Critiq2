import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
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
 * Lightweight account-name lookup ({id, name} only, soft-delete-guarded) for a
 * surface that already has access to the account via a different owned entity —
 * e.g. the rep's own recording, whose accountId was set through an access-checked
 * assign. Avoids getAccountForUser's contacts query + summary/context columns when
 * only the name is rendered.
 */
export async function getAccountNameById(
  accountId: string,
): Promise<{ id: string; name: string } | null> {
  const rows = await db
    .select({ id: accountsTbl.id, name: accountsTbl.name })
    .from(accountsTbl)
    .where(and(eq(accountsTbl.id, accountId), isNull(accountsTbl.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
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

/**
 * Cold-start learning model. Critiq personalizes an account's coaching as the
 * rep logs calls against it; the per-account view frames this as progress toward
 * a target (~10 calls, per the cold-start UX framing). No call/interaction data
 * exists at this build stage (it arrives in later recording/debrief phases), so
 * `loggedCalls` is 0 today — but `getLearningProgress` takes the count as an
 * argument so a later phase wires the real number in without touching callers.
 */
export const COLD_START_TARGET_CALLS = 10;

export type LearningProgress = {
  loggedCalls: number;
  target: number;
  /** 0–100, clamped. */
  percent: number;
  /** true once enough calls exist that coaching is account-personalized. */
  isWarm: boolean;
};

export function getLearningProgress(loggedCalls: number): LearningProgress {
  const calls =
    Number.isFinite(loggedCalls) && loggedCalls > 0
      ? Math.floor(loggedCalls)
      : 0;
  const target = COLD_START_TARGET_CALLS;
  const percent = Math.min(100, Math.round((calls / target) * 100));
  return { loggedCalls: calls, target, percent, isWarm: calls >= target };
}

export type AccountContact = {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
};

export type AccountDetail = {
  id: string;
  name: string;
  stage: string;
  /** Shared running intelligence summary; null at cold start. */
  summary: string | null;
  /** Shared, human-entered context about this account (Phase 35a); null if unset. */
  context: string | null;
  /** The viewing rep's role on this account ('owner' | 'collaborator'). */
  role: string;
  createdAt: Date;
  updatedAt: Date;
  contacts: AccountContact[];
  /**
   * Calls logged against this account. Always 0 at this build stage — no
   * interaction data exists yet; a later phase populates this from real activity.
   */
  loggedCalls: number;
};

/**
 * Fetch one account for the per-account view, but ONLY if the rep is assigned to
 * it — the inner join on `account_rep_joins` is the access boundary, so a rep
 * can't open an account they're not on by guessing its id. Soft-deleted accounts
 * are excluded. Returns null when the account doesn't exist, is deleted, or the
 * rep isn't assigned. Includes the shared `summary` (the list view omits it) and
 * the account's non-deleted contacts (primary first, then alphabetical).
 */
export async function getAccountForUser(
  userId: string,
  accountId: string,
): Promise<AccountDetail | null> {
  const rows = await db
    .select({
      id: accountsTbl.id,
      name: accountsTbl.name,
      stage: accountsTbl.stage,
      summary: accountsTbl.summary,
      context: accountsTbl.context,
      role: accountRepJoins.role,
      createdAt: accountsTbl.createdAt,
      updatedAt: accountsTbl.updatedAt,
    })
    .from(accountRepJoins)
    .innerJoin(accountsTbl, eq(accountRepJoins.accountId, accountsTbl.id))
    .where(
      and(
        eq(accountRepJoins.userId, userId),
        eq(accountRepJoins.accountId, accountId),
        isNull(accountsTbl.deletedAt),
      ),
    )
    .limit(1);

  const account = rows[0];
  if (!account) return null;

  const contactRows = await db
    .select({
      id: contacts.id,
      name: contacts.name,
      title: contacts.title,
      email: contacts.email,
      phone: contacts.phone,
      isPrimary: contacts.isPrimary,
    })
    .from(contacts)
    .where(and(eq(contacts.accountId, accountId), isNull(contacts.deletedAt)))
    .orderBy(desc(contacts.isPrimary), asc(contacts.name));

  return { ...account, contacts: contactRows, loggedCalls: 0 };
}
