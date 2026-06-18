/**
 * The DB-backed readers that feed working-memory assembly (Phase 25). The only impure part
 * of the module — everything else (assemble/format/budget/methodology) is pure. These read
 * the existing semantic + episodic tables; they add nothing and write nothing.
 *
 * PRIVACY DECISION (DEC-039): the raw interactions are scoped to THIS REP on THIS ACCOUNT
 * (userId AND accountId), not all reps. The account's SHARED, cross-rep intelligence still
 * flows into the working set via the account semantic summary (Phase 23, rep-agnostic); the
 * raw verbatim reports stay rep-private (rep-side data is isolated — the locked privacy
 * model). So a rep's working set never exposes another rep's raw call notes.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { callDebriefs } from "@/db/schema";
import type { DebriefReport } from "@/lib/debrief/types";
import { buildRepProfileBlock } from "@/lib/precall/repProfile";
import { getRepSummary } from "@/lib/repconsolidation/store";
import { getAccountSummary } from "@/lib/consolidation/store";
import { formatRepProfileFromSummary, formatAccountSummaryBlock } from "./format";
import type { RawInteraction, RepProfileSource } from "./types";

/** Coerce the stored `report` jsonb into a DebriefReport (defensive — jsonb is `unknown`). */
function coerceReport(v: unknown): DebriefReport {
  const o = (v ?? {}) as Record<string, unknown>;
  const str = (x: unknown): string | undefined =>
    typeof x === "string" && x.trim().length > 0 ? x : undefined;
  return {
    objective: str(o.objective),
    // `happened` is required by the type; default to "" if a malformed row lacks it.
    happened: str(o.happened) ?? "",
    reaction: str(o.reaction),
    commitments: str(o.commitments),
    surprises: str(o.surprises),
  };
}


/**
 * This rep's recent COMPLETED debriefs WITH THIS ACCOUNT, newest first, capped at `limit`,
 * plus the total completed count (so the caller can disclose how many older ones were not
 * fetched — no silent cap). Rep-private scope (userId + accountId) per DEC-039.
 */
export async function getRecentRawInteractionsForAccount(
  userId: string,
  accountId: string,
  limit: number,
): Promise<{ interactions: RawInteraction[]; totalCompleted: number }> {
  // Phase 20 guarantees a completed debrief has a non-empty `happened`; this content guard
  // (applied IN SQL, before LIMIT, so the cap counts only valid rows and totalCompleted
  // stays exact) drops any malformed/backfilled row that would otherwise occupy a raw slot
  // with a content-less stub.
  const where = and(
    eq(callDebriefs.userId, userId),
    eq(callDebriefs.accountId, accountId),
    eq(callDebriefs.status, "completed"),
    sql`btrim(coalesce(${callDebriefs.report}->>'happened', '')) <> ''`,
  );

  const [countRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(callDebriefs)
    .where(where);
  const totalCompleted = countRow?.n ?? 0;

  if (totalCompleted === 0) return { interactions: [], totalCompleted: 0 };

  const rows = await db
    .select({
      debriefId: callDebriefs.id,
      completedAt: callDebriefs.completedAt,
      createdAt: callDebriefs.createdAt,
      report: callDebriefs.report,
    })
    .from(callDebriefs)
    .where(where)
    // NULLS LAST so a defensively-possible completed debrief with a null completedAt can't
    // sort above genuinely-newer calls (mirrors the consolidation readers).
    .orderBy(
      sql`${callDebriefs.completedAt} DESC NULLS LAST`,
      desc(callDebriefs.createdAt),
    )
    .limit(limit);

  const interactions: RawInteraction[] = rows.map((r) => ({
    debriefId: r.debriefId,
    occurredAt: r.completedAt ?? r.createdAt,
    report: coerceReport(r.report),
  }));

  return { interactions, totalCompleted };
}

/**
 * Resolve the rep-profile layer with the locked cold-start fallback: the LEARNED rep
 * summary (rep_summaries, Phase 24) if the rep has crossed the first consolidation interval
 * and the profile is completed; otherwise the static INTAKE profile (Phase 18); otherwise
 * none (a brand-new rep with no intake answers yet).
 */
export async function resolveRepProfile(
  userId: string,
): Promise<{ text: string | null; source: RepProfileSource }> {
  const summary = await getRepSummary(userId);
  if (summary && summary.status === "completed") {
    const learned = formatRepProfileFromSummary(summary);
    if (learned) return { text: learned, source: "learned" };
  }
  const intake = await buildRepProfileBlock(userId);
  if (intake) return { text: intake, source: "intake" };
  return { text: null, source: "none" };
}

/** Read + format the account semantic summary block (null at cold start / no usable row). */
export async function resolveAccountSummary(
  accountId: string,
  accountName: string,
): Promise<string | null> {
  const summary = await getAccountSummary(accountId);
  if (summary && summary.status === "completed") {
    return formatAccountSummaryBlock(summary, accountName);
  }
  return null;
}
