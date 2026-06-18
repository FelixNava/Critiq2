import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import AppHeader from "@/components/AppHeader";
import StageBadge from "@/components/accounts/StageBadge";
import type { InitialCoaching } from "@/components/coaching/CoachingPanel";
import DebriefPanel, {
  type InitialDebrief,
} from "@/components/debrief/DebriefPanel";
import { getAccountForUser } from "@/lib/accounts";
import { getLatestCoachingForDebrief } from "@/lib/coaching/store";
import type {
  CoachingPriority,
  CoachingReinforcement,
  ScoreSnapshot,
} from "@/lib/coaching/types";
import { getLatestDebriefForAccount } from "@/lib/debrief/store";
import type { DebriefObservation } from "@/lib/debrief/types";

export const dynamic = "force-dynamic";

export default async function DebriefPage({
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

  const latest = await getLatestDebriefForAccount(userId, id);
  const initialDebrief: InitialDebrief | null = latest
    ? {
        id: latest.id,
        recap: latest.recap,
        observations:
          (latest.observations as DebriefObservation[]) ?? [],
        commitments: (latest.commitments as string[]) ?? [],
        openQuestions: (latest.openQuestions as string[]) ?? [],
        summary: latest.summary,
        usefulnessRating: latest.usefulnessRating,
      }
    : null;

  // The latest coaching for that debrief (if the rep has already coached it).
  const latestCoaching = latest
    ? await getLatestCoachingForDebrief(userId, latest.id)
    : null;
  const initialCoaching: InitialCoaching | null = latestCoaching
    ? {
        id: latestCoaching.id,
        priorities: (latestCoaching.priorities as CoachingPriority[]) ?? [],
        reinforce:
          (latestCoaching.reinforce as CoachingReinforcement[]) ?? [],
        nextStep: latestCoaching.nextStep,
        summary: latestCoaching.summary,
        scoreSnapshot:
          (latestCoaching.scoreSnapshot as ScoreSnapshot | null) ?? null,
        usefulnessRating: latestCoaching.usefulnessRating,
      }
    : null;

  return (
    <div className="min-h-dvh bg-slate-50">
      <AppHeader backHref={`/accounts/${id}`} backLabel={account.name} />

      <main className="mx-auto max-w-3xl px-6 py-12">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold text-slate-900">
              Debrief your call
            </h1>
            <p className="mt-1 truncate text-sm text-slate-500">
              {account.name}
            </p>
          </div>
          <StageBadge stage={account.stage} className="mt-1" />
        </div>

        <DebriefPanel
          accountId={id}
          hasSummary={Boolean(account.summary && account.summary.trim())}
          initialDebrief={initialDebrief}
          initialCoaching={initialCoaching}
        />
      </main>
    </div>
  );
}
