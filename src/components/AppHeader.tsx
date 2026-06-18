import Link from "next/link";
import { signOut } from "@/auth";

/**
 * Shared signed-in header. Brand on the left (links to the dashboard), an
 * optional back link, and a sign-out action on the right. Mirrors the inline
 * header the dashboard already uses so the in-app surfaces feel consistent.
 */
export default function AppHeader({
  backHref,
  backLabel,
}: {
  backHref?: string;
  backLabel?: string;
} = {}) {
  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
      <div className="flex items-center gap-4">
        <Link
          href="/dashboard"
          className="text-lg font-semibold tracking-tight text-slate-900"
        >
          Critiq
        </Link>
        {process.env.VERCEL_ENV !== "production" && (
          <Link
            href="/recording-lab"
            className="text-sm font-medium text-indigo-600 transition hover:text-indigo-800"
          >
            Recording Lab
          </Link>
        )}
        {backHref && (
          <Link
            href={backHref}
            className="text-sm font-medium text-slate-500 transition hover:text-slate-900"
          >
            ← {backLabel ?? "Back"}
          </Link>
        )}
      </div>
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
  );
}
