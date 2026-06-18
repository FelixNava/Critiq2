/**
 * Rep-profile block (Phase 18). Formats a rep's intake answers into a stable text
 * block used as the SECOND cached system layer (the locked memory architecture:
 * methodology cached forever + rep intake cached per rep). This is the first live
 * consumer of that rep-intake cache layer.
 *
 * The formatter is pure + deterministic (fixed dimension/question ordering) so the
 * block is byte-identical across calls for the same rep → it actually caches. The
 * DB reader is the only impure part.
 */

import { asc } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { repIntakeResponses } from "@/db/schema";
import { INTAKE_DIMENSIONS, type IntakeDimension } from "@/lib/intake";

/** Human labels for the intake dimensions (no dev jargon). */
const DIMENSION_LABELS: Record<IntakeDimension, string> = {
  identity: "Identity & motivation",
  relationships: "Relationship style",
  sales_psychology: "Sales psychology",
  operational_habits: "Operational habits",
  market_intelligence: "Market intelligence",
  life_context: "Life context",
};

export interface IntakeAnswerRow {
  dimension: string;
  questionKey: string;
  answer: unknown;
}

/** Render one stored answer (jsonb) as a readable scalar string, or null if empty. */
function renderAnswer(answer: unknown): string | null {
  if (answer == null) return null;
  if (typeof answer === "string") {
    const t = answer.trim();
    return t.length > 0 ? t : null;
  }
  if (typeof answer === "number" || typeof answer === "boolean") {
    return String(answer);
  }
  if (Array.isArray(answer)) {
    const parts = answer
      .map((a) => renderAnswer(a))
      .filter((s): s is string => s != null);
    return parts.length > 0 ? parts.join(", ") : null;
  }
  // Object: render its scalar values (stable key order).
  if (typeof answer === "object") {
    const obj = answer as Record<string, unknown>;
    const parts = Object.keys(obj)
      .sort()
      .map((k) => renderAnswer(obj[k]))
      .filter((s): s is string => s != null);
    return parts.length > 0 ? parts.join(", ") : null;
  }
  return null;
}

/**
 * Format intake rows into the stable rep-profile block. Deterministic: dimensions
 * in INTAKE_DIMENSIONS order, questions alphabetical within a dimension. Returns
 * null when the rep has no usable answers (so the caller drops the empty layer).
 */
export function formatRepProfile(rows: IntakeAnswerRow[]): string | null {
  const byDimension = new Map<string, { key: string; value: string }[]>();
  for (const row of rows) {
    const value = renderAnswer(row.answer);
    if (value == null) continue;
    const list = byDimension.get(row.dimension) ?? [];
    list.push({ key: row.questionKey, value });
    byDimension.set(row.dimension, list);
  }

  const sections: string[] = [];
  for (const dim of INTAKE_DIMENSIONS) {
    const list = byDimension.get(dim);
    if (!list || list.length === 0) continue;
    list.sort((a, b) => a.key.localeCompare(b.key));
    const label = DIMENSION_LABELS[dim] ?? dim;
    const lines = list.map((q) => `  - ${q.value}`).join("\n");
    sections.push(`${label}:\n${lines}`);
  }

  if (sections.length === 0) return null;
  return [
    "THE REP YOU ARE COACHING (from their intake — tailor the brief to how this rep sells):",
    "",
    ...sections,
  ].join("\n");
}

/**
 * Read a rep's intake answers and build the cached rep-profile block. Returns null
 * when the rep hasn't answered anything usable yet (cold rep → no layer).
 */
export async function buildRepProfileBlock(
  userId: string,
): Promise<string | null> {
  const rows = await db
    .select({
      dimension: repIntakeResponses.dimension,
      questionKey: repIntakeResponses.questionKey,
      answer: repIntakeResponses.answer,
    })
    .from(repIntakeResponses)
    .where(eq(repIntakeResponses.userId, userId))
    .orderBy(asc(repIntakeResponses.dimension), asc(repIntakeResponses.questionKey));

  return formatRepProfile(rows);
}
