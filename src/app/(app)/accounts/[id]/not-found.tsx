import Link from "next/link";
import AppHeader from "@/components/AppHeader";

/**
 * Rendered when `getAccountForUser` returns null for the detail page — the
 * account doesn't exist, was deleted, or isn't assigned to this rep. Keeps the
 * app shell + a friendly empty state instead of Next's bare default 404.
 */
export default function AccountNotFound() {
  return (
    <div className="min-h-dvh bg-slate-50">
      <AppHeader backHref="/accounts" backLabel="Accounts" />

      <main className="mx-auto max-w-3xl px-6 py-12">
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <h1 className="text-base font-semibold text-slate-900">
            We couldn&apos;t find that account
          </h1>
          <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
            It may have been removed, or it isn&apos;t one of yours. Head back to
            your accounts to keep going.
          </p>
          <Link
            href="/accounts"
            className="mt-5 inline-block rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
          >
            Back to accounts →
          </Link>
        </div>
      </main>
    </div>
  );
}
