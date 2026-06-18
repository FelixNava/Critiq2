/**
 * Call-script data layer (Phase 19). Thin typed helpers over the call_scripts
 * table. A script is generated synchronously inside the rep's request (the rep is
 * waiting), so — like the Phase 18 brief — there is no cron, no CAS claim: each
 * generation is a fresh row. Ownership is the access boundary on read/update.
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { callScripts, type CallScript } from "@/db/schema";
import type { StyleMode } from "./style";
import type { ScriptResult } from "./types";

export interface CreateScriptInput {
  briefId: string;
  accountId: string;
  userId: string;
  styleMode: StyleMode;
  /** The in-force objective snapshotted from the brief at generation time. */
  objective: string;
}

/**
 * Create the script row already in `processing` (the AI call runs right after, in
 * the same request). The AI output lands via finishScript.
 */
export async function createScript(
  input: CreateScriptInput,
  nowMs = Date.now(),
): Promise<string> {
  const [row] = await db
    .insert(callScripts)
    .values({
      briefId: input.briefId,
      accountId: input.accountId,
      userId: input.userId,
      styleMode: input.styleMode,
      objective: input.objective,
      status: "processing",
      attempts: 1,
      startedAt: new Date(nowMs),
    })
    .returning({ id: callScripts.id });
  return row.id;
}

/** Persist a completed script. */
export async function finishScript(
  scriptId: string,
  result: ScriptResult,
): Promise<void> {
  await db
    .update(callScripts)
    .set({
      status: "completed",
      styleMode: result.styleMode,
      opener: result.opener,
      sections: result.sections,
      closing: result.closing,
      deliveryNotes: result.deliveryNotes,
      error: null,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(callScripts.id, scriptId));
}

/** Mark a script failed (the generation threw). */
export async function failScript(
  scriptId: string,
  message: string,
): Promise<void> {
  await db
    .update(callScripts)
    .set({
      status: "failed",
      error: message.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(eq(callScripts.id, scriptId));
}

/** A script owned by the rep (ownership = access boundary). Null if not theirs. */
export async function getScriptForUser(
  userId: string,
  scriptId: string,
): Promise<CallScript | null> {
  const [row] = await db
    .select()
    .from(callScripts)
    .where(and(eq(callScripts.id, scriptId), eq(callScripts.userId, userId)))
    .limit(1);
  return row ?? null;
}

/**
 * The rep's most recent COMPLETED script for a given brief (the page's "latest"
 * view). Filtered to `completed` deliberately: a failed rewrite creates a newer row
 * but must NOT bury the rep's last good script — the latest usable script is what
 * the page and the GET route want.
 */
export async function getLatestScriptForBrief(
  userId: string,
  briefId: string,
): Promise<CallScript | null> {
  const [row] = await db
    .select()
    .from(callScripts)
    .where(
      and(
        eq(callScripts.userId, userId),
        eq(callScripts.briefId, briefId),
        eq(callScripts.status, "completed"),
      ),
    )
    .orderBy(desc(callScripts.createdAt))
    .limit(1);
  return row ?? null;
}

/** Set the rep's 1–5 usefulness rating on a script they own (PRD adoption metric). */
export async function setScriptRating(
  userId: string,
  scriptId: string,
  rating: number,
): Promise<CallScript | null> {
  const existing = await getScriptForUser(userId, scriptId);
  if (!existing) return null;
  const [row] = await db
    .update(callScripts)
    .set({ usefulnessRating: rating, updatedAt: new Date() })
    .where(eq(callScripts.id, scriptId))
    .returning();
  return row ?? null;
}
