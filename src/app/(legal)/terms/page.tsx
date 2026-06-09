import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — Critiq",
};

export default function TermsPage() {
  return (
    <article className="prose-slate">
      <h1 className="text-2xl font-semibold text-slate-900">Terms of Service</h1>
      <p className="mt-4 text-slate-600">
        Critiq is currently in private beta. Full Terms of Service will be
        published here before general availability.
      </p>
      <p className="mt-4 text-slate-600">
        If you have questions about using Critiq during the beta, reach us at{" "}
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
