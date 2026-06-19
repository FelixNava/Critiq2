"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  buttonClass,
  cardClass,
  mobileInputClass,
  secondaryButtonClass,
  textareaClass,
} from "@/components/onboarding/ui";
import { IMPORT_MAX_CHARS } from "@/lib/debrief/import";
import type { DebriefObservation } from "@/lib/debrief/types";

interface ImportedDebrief {
  id: string;
  recap: string | null;
  observations: DebriefObservation[];
  commitments: string[];
  openQuestions: string[];
  summary: string | null;
}

function coerce(raw: unknown): ImportedDebrief {
  const d = (raw ?? {}) as Partial<ImportedDebrief>;
  return {
    id: String(d.id ?? ""),
    recap: d.recap ?? null,
    observations: Array.isArray(d.observations) ? d.observations : [],
    commitments: Array.isArray(d.commitments) ? d.commitments : [],
    openQuestions: Array.isArray(d.openQuestions) ? d.openQuestions : [],
    summary: d.summary ?? null,
  };
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin text-current"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}

/**
 * Import-a-past-call surface (Phase 35b). The rep pastes notes or a transcript; Critiq
 * structures it into a debrief that joins this account's memory. On success it confirms
 * what landed and offers to import another. The draft persists per account (project rule).
 */
export default function ImportPanel({ accountId }: { accountId: string }) {
  const draftKey = useMemo(
    () => `critiq:import:v1:${accountId}`,
    [accountId],
  );

  const [about, setAbout] = useState("");
  const [rawText, setRawText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportedDebrief | null>(null);

  // Restore a draft (rep input persists across reloads).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(draftKey);
      if (saved) {
        const parsed = JSON.parse(saved) as { about?: string; rawText?: string };
        if (parsed.about) setAbout(parsed.about);
        if (parsed.rawText) setRawText(parsed.rawText);
      }
    } catch {
      /* ignore storage errors */
    }
  }, [draftKey]);

  useEffect(() => {
    try {
      if (about.trim() || rawText.trim()) {
        window.localStorage.setItem(
          draftKey,
          JSON.stringify({ about, rawText }),
        );
      }
    } catch {
      /* ignore storage errors */
    }
  }, [draftKey, about, rawText]);

  async function submit() {
    setError(null);
    if (rawText.trim().length < 20) {
      setError("Paste the call notes or transcript you want to import first.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/accounts/${accountId}/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rawText, about: about.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Couldn't process that import. Try again.");
        return;
      }
      setResult(coerce(data.debrief));
      try {
        window.localStorage.removeItem(draftKey);
      } catch {
        /* ignore */
      }
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setAbout("");
    setRawText("");
    setResult(null);
    setError(null);
  }

  if (result) {
    return (
      <div className="mt-8 space-y-6">
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
          <h2 className="text-sm font-semibold text-emerald-900">
            Imported — it&apos;s part of this account&apos;s memory now
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-emerald-800">
            Critiq read through it and folded it into what it knows about this
            account. Your next prep and coaching will factor it in.
          </p>
        </section>

        {result.summary && (
          <ResultCard title="The takeaway">
            <p className="text-sm leading-relaxed text-slate-700">
              {result.summary}
            </p>
          </ResultCard>
        )}
        {result.recap && (
          <ResultCard title="What Critiq took from it">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
              {result.recap}
            </p>
          </ResultCard>
        )}
        {result.commitments.length > 0 && (
          <ResultCard title="Commitments & next steps">
            <ul className="space-y-2">
              {result.commitments.map((c, i) => (
                <li
                  key={i}
                  className="flex gap-2 text-sm leading-relaxed text-slate-700"
                >
                  <span aria-hidden className="text-slate-400">
                    →
                  </span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </ResultCard>
        )}

        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={reset}
            className={`${secondaryButtonClass} sm:w-auto sm:px-6`}
          >
            Import another call
          </button>
          <Link
            href={`/accounts/${accountId}`}
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-slate-300 px-6 text-sm font-medium text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
          >
            Back to the account
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-8 space-y-6">
      <p className="text-sm leading-relaxed text-slate-600">
        Paste your notes or a transcript from a call that already happened. Critiq
        reads it the same way it reads a debrief — so a deal&apos;s history is in its
        memory from day one, and your coaching is sharper sooner.
      </p>

      <section className={cardClass}>
        <div className="space-y-6">
          <div>
            <label
              htmlFor="import-about"
              className="block text-sm font-semibold text-slate-900"
            >
              What was this call about?
              <span className="ml-2 font-normal text-slate-400">Optional</span>
            </label>
            <p className="mt-1 text-sm text-slate-500">
              A one-liner helps Critiq frame the notes below.
            </p>
            <input
              id="import-about"
              type="text"
              value={about}
              onChange={(e) => setAbout(e.target.value.slice(0, 2000))}
              disabled={submitting}
              placeholder="e.g. First walkthrough at the warehouse, met the ops lead."
              className={`mt-3 ${mobileInputClass} disabled:opacity-60`}
            />
          </div>

          <div>
            <label
              htmlFor="import-text"
              className="block text-sm font-semibold text-slate-900"
            >
              Your notes or transcript
            </label>
            <p className="mt-1 text-sm text-slate-500">
              Paste it however you have it — rough notes or a full transcript both
              work.
            </p>
            <textarea
              id="import-text"
              value={rawText}
              onChange={(e) =>
                setRawText(e.target.value.slice(0, IMPORT_MAX_CHARS))
              }
              disabled={submitting}
              placeholder="Paste your call notes or transcript here…"
              className={`${textareaClass} mt-3 min-h-[220px] text-base disabled:opacity-60 sm:text-sm`}
              aria-describedby="import-text-count"
            />
            <p
              id="import-text-count"
              className="mt-1 text-right text-xs text-slate-400"
            >
              {rawText.length.toLocaleString()} /{" "}
              {IMPORT_MAX_CHARS.toLocaleString()}
            </p>
          </div>
        </div>

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          aria-busy={submitting}
          className={`${buttonClass} mt-6 flex items-center justify-center gap-2`}
        >
          {submitting && <Spinner />}
          {submitting ? "Reading it in…" : "Import this call"}
        </button>
      </section>
    </div>
  );
}

function ResultCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cardClass}>
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}
