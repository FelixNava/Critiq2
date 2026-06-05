import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import AppHeader from "@/components/AppHeader";
import { listAccountsForUser, stageLabel } from "@/lib/accounts";

export const dynamic = "force-dynamic";

const STAGE_BADGE: Record<string, string> = {
  prospecting: "bg-slate-100 text-slate-700",
  active: "bg-emerald-100 text-emerald-700",
  at_risk: "bg-amber-100 text-amber-700",
  won: "bg-blue-100 text-blue-700",
  dormant: "bg-slate-100 text-slate-500",
};

export default async function AccountsPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login");

  const accounts = await listAccountsForUser(userId);

  return (
    <div className="min-h-dvh bg-slate-50">
      <AppHeader backHref="/dashboard" backLabel="Dashboard" />

      <main className="mx-auto max-w-3xl px-6 py-12">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">
              Your accounts
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              The companies you sell into. Critiq builds a shared picture of each
              one as you work it.
            </p>
          </div>
          <Link
            href="/accounts/new"
            className="shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
          >
            New account
          </Link>
        </div>

        {accounts.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <h2 className="text-base font-semibold text-slate-900">
              No accounts yet
            </h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
              Add your first account to start tracking it. As you log calls,
              Critiq learns the account and sharpens your coaching.
            </p>
            <Link
              href="/accounts/new"
              className="mt-5 inline-block rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
            >
              Add an account →
            </Link>
          </div>
        ) : (
          <ul className="mt-8 space-y-3">
            {accounts.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold text-slate-900">
                    {a.name}
                  </p>
                  <p className="mt-0.5 text-sm text-slate-500">
                    {a.contactCount}{" "}
                    {a.contactCount === 1 ? "contact" : "contacts"}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
                    STAGE_BADGE[a.stage] ?? "bg-slate-100 text-slate-700"
                  }`}
                >
                  {stageLabel(a.stage)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
