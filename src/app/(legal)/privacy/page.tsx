import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Critiq",
};

export default function PrivacyPage() {
  return (
    <article className="prose-slate">
      <h1 className="text-2xl font-semibold text-slate-900">Privacy Policy</h1>
      <p className="mt-4 text-slate-600">
        Critiq is currently in private beta. Our full Privacy Policy — covering
        how call recordings, transcripts, and account information are stored and
        used — will be published here before general availability.
      </p>
      <p className="mt-4 text-slate-600">
        During the beta, your data is accessible only to you and Critiq
        administrators, and is never sold.
      </p>

      <h2 className="mt-6 text-lg font-semibold text-slate-900">
        Deleting your data
      </h2>
      <p className="mt-2 text-slate-600">
        You can permanently delete your account at any time from your{" "}
        <a href="/profile" className="font-medium text-slate-900 underline">
          profile
        </a>
        . Deleting your account immediately and permanently removes everything
        private to you — your call recordings and their audio, transcripts,
        scores, call prep, debriefs, coaching, your learned profile, and your
        notes. Shared account records your team relies on remain, with your
        personal link removed. This cannot be undone.
      </p>

      <p className="mt-4 text-slate-600">
        Questions? Email{" "}
        <a
          href="mailto:hello@critiq.firstlap.dev"
          className="font-medium text-slate-900 underline"
        >
          hello@critiq.firstlap.dev
        </a>
        .
      </p>
    </article>
  );
}
