import { eq } from "drizzle-orm";
import { db } from "@/db";
import { repIntakeProgress, users } from "@/db/schema";

/**
 * The six areas the rep intake assessment covers. Order is the presentation
 * order. Session 1 covers the first two (identity, relationships).
 */
export const INTAKE_DIMENSIONS = [
  "identity",
  "relationships",
  "sales_psychology",
  "operational_habits",
  "market_intelligence",
  "life_context",
] as const;

export type IntakeDimension = (typeof INTAKE_DIMENSIONS)[number];

export const INTAKE_TOTAL = INTAKE_DIMENSIONS.length; // 6

export type IntakeProgress = {
  completed: number;
  total: number;
  percent: number;
  dimensions: Record<IntakeDimension, boolean>;
};

const KNOWN = new Set<string>(INTAKE_DIMENSIONS);

/**
 * Build an IntakeProgress from an iterable of completed dimension keys. Unknown
 * keys are ignored; each known key counts at most once.
 */
export function computeIntakeProgress(
  completed: Iterable<string>,
): IntakeProgress {
  const done = new Set<string>();
  for (const dim of completed) {
    if (KNOWN.has(dim)) done.add(dim);
  }

  const dimensions = {} as Record<IntakeDimension, boolean>;
  for (const dim of INTAKE_DIMENSIONS) {
    dimensions[dim] = done.has(dim);
  }

  const count = done.size;
  return {
    completed: count,
    total: INTAKE_TOTAL,
    percent: Math.round((count / INTAKE_TOTAL) * 100),
    dimensions,
  };
}

/**
 * Read a rep's completed dimensions from the DB and return their progress.
 */
export async function getIntakeProgress(
  userId: string,
): Promise<IntakeProgress> {
  const rows = await db
    .select({ dimension: repIntakeProgress.dimension })
    .from(repIntakeProgress)
    .where(eq(repIntakeProgress.userId, userId));

  return computeIntakeProgress(rows.map((r) => r.dimension));
}

/**
 * Session 1 is complete once both identity and relationships are done.
 */
export function isSession1Complete(p: IntakeProgress): boolean {
  return p.dimensions.identity && p.dimensions.relationships;
}

/**
 * Session 2 is complete once the three contextual dimensions are done:
 * sales psychology, operational habits, and market intelligence. Life context
 * (the sixth dimension) is surfaced separately and later, so it is not part of
 * Session 2.
 */
export function isSession2Complete(p: IntakeProgress): boolean {
  return (
    p.dimensions.sales_psychology &&
    p.dimensions.operational_habits &&
    p.dimensions.market_intelligence
  );
}

/**
 * Life Context is complete once its dimension is recorded. It is the sixth and
 * final intake area, surfaced only after the trust-gate opens.
 */
export function isLifeContextComplete(p: IntakeProgress): boolean {
  return p.dimensions.life_context;
}

/* ------------------------------------------------------------------ *
 * Free-text validation — shared by every intake route.
 *
 * Hoisted here in Phase 8 so session1 / session2 / life-context share one
 * copy (resolves the byte-for-byte duplication flagged as DEC-008 P2-a).
 * ------------------------------------------------------------------ */

export const MAX_FREE_TEXT = 2000;

export type FreeText = { value: string | null; tooLong: boolean };

/** Coerce a free-text field: non-string → null, trim, empty → null, flag >2000. */
export function freeText(raw: unknown): FreeText {
  if (typeof raw !== "string") return { value: null, tooLong: false };
  const trimmed = raw.trim();
  if (trimmed.length > MAX_FREE_TEXT) return { value: null, tooLong: true };
  return { value: trimmed.length === 0 ? null : trimmed, tooLong: false };
}

/* ------------------------------------------------------------------ *
 * Life Context (dimension 6) trust-gate.
 *
 * Life Context is the most personal dimension, so it stays hidden until the
 * rep has been with Critiq a while ("delayed / trust-gated" per the Signal
 * spec). There are no call/debrief "use" events yet (those arrive in later
 * phases), so for now the gate keys off elapsed time since the account was
 * created. It is structured so a later phase can swap the anchor to real
 * activity without changing callers.
 * ------------------------------------------------------------------ */

/** Days after account creation before Life Context unlocks. Env-overridable. */
export const LIFE_CONTEXT_GATE_DAYS = (() => {
  const raw = process.env.LIFE_CONTEXT_GATE_DAYS;
  const n = raw != null ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : 7;
})();

const DAY_MS = 24 * 60 * 60 * 1000;

/** When Life Context unlocks for an account created at the given time. */
export function lifeContextUnlockAt(accountCreatedAt: Date): Date {
  return new Date(accountCreatedAt.getTime() + LIFE_CONTEXT_GATE_DAYS * DAY_MS);
}

/** Whether Life Context is unlocked for an account of the given age. */
export function isLifeContextUnlocked(
  accountCreatedAt: Date,
  now: Date = new Date(),
): boolean {
  return now.getTime() >= lifeContextUnlockAt(accountCreatedAt).getTime();
}

export type LifeContextGate = {
  unlocked: boolean;
  unlockAt: Date;
  createdAt: Date;
};

/**
 * Resolve the Life Context gate for a user from their account age. Returns null
 * if the user can't be found.
 */
export async function getLifeContextGate(
  userId: string,
  now: Date = new Date(),
): Promise<LifeContextGate | null> {
  const rows = await db
    .select({ createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const createdAt = rows[0]?.createdAt;
  if (!createdAt) return null;

  const unlockAt = lifeContextUnlockAt(createdAt);
  return {
    unlocked: now.getTime() >= unlockAt.getTime(),
    unlockAt,
    createdAt,
  };
}
