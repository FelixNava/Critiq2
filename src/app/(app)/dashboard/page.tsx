import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import AppHeader from "@/components/AppHeader";
import StageBadge from "@/components/accounts/StageBadge";
import { listAccountsForUser } from "@/lib/accounts";
import {
  getIntakeProgress,
  getLifeContextGate,
  isSession1Complete,
  isSession2Complete,
  isLifeContextComplete,
} from "@/lib/intake";

export const dynamic = "force-dynamic";

// Phase 27 — Cold-Start UX. The dashboard leads with the rep's WORKSPACE (their
// accounts, or a prominent "add your first account" CTA when they have none),
// because the whole product — pre-call briefs, debriefs, coaching — lives inside
// an account. Intake progress is kept but demoted to a secondary section so a new
// user's primary signal is "add/open a company you're selling to," not "finish
// your profile." (Fixes the cold-start dead-end: signed in with zero accounts, the
// app previously looked empty.)
export default async function DashboardPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login");

  const name =
    session?.user?.name?.split(" ")[0] || session?.user?.email || "there";

  const progress = await getIntakeProgress(userId);
  if (!isSession1Complete(progress)) redirect("/onboarding");

  const accounts = await listAccountsForUser(userId);
  const hasAccounts = accounts.length > 0;

  const session2Done = isSession2Complete(progress);
  const lifeContextDone = isLifeContextComplete(progress);

  // The Life Context gate only matters once Session 2 is done and Life Context
  // itself isn't finished — skip the extra query otherwise.
  const gate =
    session2Done && !lifeContextDone ? await getLifeContextGate(userId) : null;
  const lifeContextUnlocked = gate?.unlocked ?? false;
  const unlockDateLabel = gate
    ? gate.unlockAt.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <div className="min-h-dvh bg-slate-50">
      <AppHeader />

      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold text-slate-900">
          Welcome, {name}.
        </h1>

        {/* Quick capture — record now, assign to an account afterward. Shown
            once the rep has accounts; a brand-new user leads with "add your
            first account" (a recording isn't useful until it has an account). */}
        {hasAccounts && (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Link
              href="/record"
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
            >
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-full bg-red-400"
              />
              Record a call
            </Link>
            <Link
              href="/recordings"
              className="rounded-md text-sm font-medium text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
            >
              Your recordings
            </Link>
          </div>
        )}

        {/* PRIMARY: the rep's workspace — accounts are where the product lives. */}
        {!hasAccounts ? (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
              Get started
            </span>
            <h2 className="mt-2 text-xl font-semibold text-slate-900">
              Add the first company you&apos;re selling to.
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">
              Critiq works account by account. Add a company you&apos;re selling
              to, and Critiq preps you before each call, debriefs you after, and
              sharpens its coaching with every one.
            </p>
            <Link
              href="/accounts/new"
              className="mt-5 inline-flex items-center gap-1 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700"
            >
              Add your first account →
            </Link>
          </div>
        ) : (
          <section className="mt-6">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">
                Your accounts
              </h2>
              <Link
                href="/accounts/new"
                className="shrink-0 rounded-lg bg-slate-900 px-3.5 py-1.5 text-sm font-semibold text-white transition hover:bg-slate-700"
              >
                New account
              </Link>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Open an account to prepare for a call or debrief one — that&apos;s
              where your coaching lives.
            </p>
            <ul className="mt-4 space-y-3">
              {accounts.slice(0, 5).map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/accounts/${a.id}`}
                    className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow-md"
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
                    <StageBadge stage={a.stage} />
                  </Link>
                </li>
              ))}
            </ul>
            {accounts.length > 5 && (
              <Link
                href="/accounts"
                className="mt-3 inline-block text-sm font-medium text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline"
              >
                View all {accounts.length} accounts →
              </Link>
            )}
          </section>
        )}

        {/* SECONDARY: profile/intake progress — kept, but no longer the headline. */}
        <div className="mt-12 border-t border-slate-200 pt-8">
          <p className="text-sm text-slate-500">
            Your intake is {progress.percent}% complete — {progress.completed} of{" "}
            {progress.total} areas done.{" "}
            <span className="text-slate-400">
              The more Critiq knows about how you sell, the sharper your coaching
              gets.
            </span>
          </p>

          {!session2Done && (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-base font-semibold text-slate-900">
                Continue your profile
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                A few more questions about how you sell — your psychology, habits,
                and how you read a market. About three minutes.
              </p>
              <Link
                href="/onboarding/sales-psychology"
                className="mt-4 inline-block rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
              >
                Continue →
              </Link>
            </div>
          )}

          {session2Done && !lifeContextDone && lifeContextUnlocked && (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-base font-semibold text-slate-900">
                One more thing
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                You&apos;ve been with Critiq about a week now. There&apos;s one
                last, more personal piece — it helps Critiq coach the person
                behind the numbers. Takes about a minute.
              </p>
              <Link
                href="/onboarding/life-context"
                className="mt-4 inline-block rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
              >
                Add the last piece →
              </Link>
            </div>
          )}

          {session2Done && !lifeContextDone && !lifeContextUnlocked && (
            <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white p-6">
              <h3 className="text-base font-semibold text-slate-900">
                One last piece, a little later
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                After about your first week
                {unlockDateLabel ? ` — around ${unlockDateLabel}` : ""}, Critiq
                opens up one final, more personal step. No rush — your coaching is
                already running.
              </p>
            </div>
          )}

          {lifeContextDone && (
            <p className="mt-4 text-sm text-slate-400">
              All six profile areas are in. Critiq keeps sharpening the more you
              use it.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
