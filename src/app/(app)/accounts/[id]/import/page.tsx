import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import AppHeader from "@/components/AppHeader";
import StageBadge from "@/components/accounts/StageBadge";
import ImportPanel from "@/components/debrief/ImportPanel";
import { getAccountForUser } from "@/lib/accounts";

export const dynamic = "force-dynamic";

/**
 * Import a past call (Phase 35b). Account-scoped, gated by getAccountForUser (the
 * assignment is the access boundary). The pasted notes/transcript are structured into
 * a debrief by ImportPanel → the import API → the Phase 20 generator.
 */
export default async function ImportPage({
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

  return (
    <div className="min-h-dvh bg-slate-50">
      <AppHeader backHref={`/accounts/${id}`} backLabel={account.name} />

      <main className="mx-auto max-w-3xl px-6 py-12">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold text-slate-900">
              Import a past call
            </h1>
            <p className="mt-1 truncate text-sm text-slate-500">
              {account.name}
            </p>
          </div>
          <StageBadge stage={account.stage} className="mt-1" />
        </div>

        <ImportPanel accountId={id} />
      </main>
    </div>
  );
}
