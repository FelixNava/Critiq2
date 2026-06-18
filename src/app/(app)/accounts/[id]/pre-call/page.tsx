import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import AppHeader from "@/components/AppHeader";
import StageBadge from "@/components/accounts/StageBadge";
import { type InitialScript } from "@/components/precall/CallScriptPanel";
import PreCallBriefPanel, {
  type InitialBrief,
} from "@/components/precall/PreCallBriefPanel";
import { getAccountForUser } from "@/lib/accounts";
import { nextInteractionNumber, resolveObjectiveMode } from "@/lib/precall/objective";
import {
  getAccountInteractionCount,
  getLatestBriefForAccount,
} from "@/lib/precall/store";
import { resolveBaselineStyleMode } from "@/lib/script/style";
import { getLatestScriptForBrief } from "@/lib/script/store";

export const dynamic = "force-dynamic";

export default async function PreCallPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login");

  const { id } = await params;
  const account = await getAccountForUser(userId, id);
  if (!account) notFound();

  const priorInteractions = await getAccountInteractionCount(id);
  const interactionNumber = nextInteractionNumber(priorInteractions);
  const objectiveMode = resolveObjectiveMode(interactionNumber);

  const latest = await getLatestBriefForAccount(userId, id);
  const initialBrief: InitialBrief | null =
    latest && latest.status === "completed"
      ? {
          id: latest.id,
          interactionNumber: latest.interactionNumber,
          narration: latest.narration,
          objective: latest.objective,
          objectiveSource: latest.objectiveSource,
          recommendedObjective: latest.recommendedObjective,
          overridden: latest.overridden,
          diagnosis: latest.diagnosis,
          approach: (latest.approach as InitialBrief["approach"]) ?? [],
          objections: (latest.objections as InitialBrief["objections"]) ?? [],
          summary: latest.summary,
          usefulnessRating: latest.usefulnessRating,
        }
      : null;

  // Phase 19: the rep's baseline style mode (seam — DEFAULT for beta; a later phase
  // derives it from intake and reads the profile THEN, not here) + the latest script
  // for the loaded brief, so a returning rep sees their script already there.
  const baselineStyleMode = resolveBaselineStyleMode(null);

  const latestScriptRow = initialBrief
    ? await getLatestScriptForBrief(userId, initialBrief.id)
    : null;
  const initialScript: InitialScript | null =
    latestScriptRow && latestScriptRow.status === "completed"
      ? {
          id: latestScriptRow.id,
          styleMode: latestScriptRow.styleMode,
          objective: latestScriptRow.objective,
          opener: latestScriptRow.opener,
          sections:
            (latestScriptRow.sections as InitialScript["sections"]) ?? [],
          closing: latestScriptRow.closing,
          deliveryNotes:
            (latestScriptRow.deliveryNotes as string[]) ?? [],
          usefulnessRating: latestScriptRow.usefulnessRating,
        }
      : null;

  return (
    <div className="min-h-dvh bg-slate-50">
      <AppHeader backHref={`/accounts/${id}`} backLabel={account.name} />

      <main className="mx-auto max-w-3xl px-6 py-12">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-slate-900">
              Prepare for your call
            </h1>
            <p className="mt-1 truncate text-sm text-slate-500">
              {account.name}
            </p>
          </div>
          <StageBadge stage={account.stage} className="mt-1" />
        </div>

        <PreCallBriefPanel
          accountId={id}
          interactionNumber={interactionNumber}
          objectiveMode={objectiveMode}
          hasSummary={Boolean(account.summary && account.summary.trim())}
          initialBrief={initialBrief}
          baselineStyleMode={baselineStyleMode}
          initialScript={initialScript}
          initialScriptBriefId={initialBrief?.id ?? null}
        />
      </main>
    </div>
  );
}
