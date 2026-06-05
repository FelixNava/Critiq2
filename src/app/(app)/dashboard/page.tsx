import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import AppHeader from "@/components/AppHeader";
import {
  getIntakeProgress,
  getLifeContextGate,
  isSession1Complete,
  isSession2Complete,
  isLifeContextComplete,
} from "@/lib/intake";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login");

  const name =
    session?.user?.name?.split(" ")[0] || session?.user?.email || "there";

  const progress = await getIntakeProgress(userId);
  if (!isSession1Complete(progress)) redirect("/onboarding");

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
        <p className="mt-2 text-slate-500">
          Your intake is {progress.percent}% complete — {progress.completed} of{" "}
          {progress.total} areas done.
        </p>
        <p className="mt-1 text-sm text-slate-400">
          Keep going whenever you&apos;re ready — the more Critiq knows, the
          sharper your coaching gets.
        </p>

        <Link
          href="/accounts"
          className="mt-8 flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-slate-300"
        >
          <span>
            <span className="block text-base font-semibold text-slate-900">
              Your accounts
            </span>
            <span className="mt-1 block text-sm text-slate-500">
              The companies you sell into — track each one and its contacts.
            </span>
          </span>
          <span aria-hidden className="text-slate-400">
            →
          </span>
        </Link>

        {!session2Done && (
          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">
              Continue your profile
            </h2>
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
          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">
              One more thing
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              You&apos;ve been with Critiq about a week now. There&apos;s one
              last, more personal piece — it helps Critiq coach the person behind
              the numbers. Takes about a minute.
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
          <div className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-white p-6">
            <h2 className="text-base font-semibold text-slate-900">
              One last piece, a little later
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              After about your first week
              {unlockDateLabel ? ` — around ${unlockDateLabel}` : ""}, Critiq
              opens up one final, more personal step. No rush — your coaching is
              already running.
            </p>
          </div>
        )}

        {lifeContextDone && (
          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">
              Your profile is complete
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              All six areas are in. Critiq will keep sharpening the more you use
              it.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
