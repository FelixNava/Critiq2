import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import {
  getIntakeProgress,
  isSession1Complete,
  isSession2Complete,
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

  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
        <span className="text-lg font-semibold tracking-tight text-slate-900">
          Critiq
        </span>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button
            type="submit"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
          >
            Sign out
          </button>
        </form>
      </header>

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

        {!session2Done && (
          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">
              Continue your profile
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              A few more questions about how you sell — your psychology,
              habits, and how you read a market. About three minutes.
            </p>
            <Link
              href="/onboarding/sales-psychology"
              className="mt-4 inline-block rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
            >
              Continue →
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
