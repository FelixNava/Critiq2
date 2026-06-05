import { auth, signOut } from "@/auth";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  const name =
    session?.user?.name?.split(" ")[0] || session?.user?.email || "there";

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
          You&apos;re signed in. Your coaching workspace will appear here as we
          build it out.
        </p>
      </main>
    </div>
  );
}
