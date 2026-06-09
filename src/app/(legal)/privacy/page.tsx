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
        administrators, and is never sold. Questions? Email{" "}
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
