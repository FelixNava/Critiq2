"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";

/**
 * Phase 37c — the "Danger zone" delete-account control. Destructive + irreversible,
 * so it's gated behind an explicit reveal and a type-your-email confirm. On success it
 * signs the (now-deleted) session out and returns to the landing page.
 */
export default function DeleteAccountSection({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmed = typed.trim().toLowerCase() === email.trim().toLowerCase();

  async function onDelete() {
    if (!confirmed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmEmail: typed.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Couldn't delete your account. Try again.");
        setSubmitting(false);
        return;
      }
      // The session now references a deleted user — clear it and leave the app.
      await signOut({ callbackUrl: "/" });
    } catch {
      setError(
        "Couldn't reach the server. Check your connection and try again.",
      );
      setSubmitting(false);
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-red-200 bg-white p-6 shadow-sm sm:p-8">
      <h2 className="text-sm font-semibold text-red-700">Delete your account</h2>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">
        Permanently delete your account and everything private to you — your call
        recordings and their audio, transcripts, scores, call prep, debriefs,
        coaching, your learned profile, and your notes. Shared account records
        your team relies on stay, with your personal link removed. This can&apos;t
        be undone.
      </p>

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-4 inline-flex min-h-[44px] items-center rounded-lg border border-red-300 px-4 text-sm font-semibold text-red-700 transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
        >
          Delete account
        </button>
      ) : (
        <div className="mt-4">
          <label
            htmlFor="confirm-email"
            className="block text-sm font-medium text-slate-700"
          >
            Type <span className="font-semibold">{email}</span> to confirm
          </label>
          <input
            id="confirm-email"
            type="email"
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            placeholder={email}
          />
          {error && (
            <p className="mt-2 text-sm text-red-600" role="alert">
              {error}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onDelete}
              disabled={!confirmed || submitting}
              className="inline-flex min-h-[44px] items-center rounded-lg bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
            >
              {submitting ? "Deleting…" : "Permanently delete my account"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setTyped("");
                setError(null);
              }}
              disabled={submitting}
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:text-slate-900 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
