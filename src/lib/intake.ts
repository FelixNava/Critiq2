import { eq } from "drizzle-orm";
import { db } from "@/db";
import { repIntakeProgress } from "@/db/schema";

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
