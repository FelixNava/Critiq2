"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buttonClass,
  cardClass,
  secondaryButtonClass,
  textareaClass,
} from "@/components/onboarding/ui";
import CoachingPanel, {
  type InitialCoaching,
} from "@/components/coaching/CoachingPanel";
import {
  REPORTER_PROMPTS,
  type ReportField,
} from "@/lib/debrief/reporter";
import type {
  DebriefObservation,
  ObservationLens,
} from "@/lib/debrief/types";

export interface InitialDebrief {
  id: string;
  recap: string | null;
  observations: DebriefObservation[];
  commitments: string[];
  openQuestions: string[];
  summary: string | null;
  usefulnessRating: number | null;
}

/** Human labels for the observation lenses (no dev jargon). */
const LENS_LABELS: Record<ObservationLens, string> = {
  structure: "Structure",
  communication: "Communication",
  relationship: "Relationship",
  general: "Observation",
};

/**
 * A subtle tint per lens so a rep can scan which pillar each observation belongs
 * to. Kept within the design system (50/700 pairs clear WCAG AA); `general` stays
 * quiet slate so the three named pillars read as the signal.
 */
const LENS_PILL_CLASS: Record<ObservationLens, string> = {
  structure: "bg-slate-100 text-slate-700",
  communication: "bg-blue-50 text-blue-700",
  relationship: "bg-emerald-50 text-emerald-700",
  general: "bg-slate-100 text-slate-500",
};

type FormState = Partial<Record<ReportField, string>>;

/**
 * Coerce a raw debrief row (from a POST/PATCH response, where the jsonb fields are
 * typed loosely and could be null) into a render-safe InitialDebrief — the same
 * `?? []` defense the server page applies, so both read paths agree on null-safety.
 */
function toInitialDebrief(raw: unknown): InitialDebrief {
  const d = (raw ?? {}) as Partial<InitialDebrief>;
  return {
    id: String(d.id ?? ""),
    recap: d.recap ?? null,
    observations: Array.isArray(d.observations) ? d.observations : [],
    commitments: Array.isArray(d.commitments) ? d.commitments : [],
    openQuestions: Array.isArray(d.openQuestions) ? d.openQuestions : [],
    summary: d.summary ?? null,
    usefulnessRating: d.usefulnessRating ?? null,
  };
}

/** Small inline spinner so an in-flight (multi-second) AI call reads as working. */
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

export default function DebriefPanel({
  accountId,
  hasSummary,
  initialDebrief,
  initialCoaching,
}: {
  accountId: string;
  hasSummary: boolean;
  initialDebrief: InitialDebrief | null;
  /** The latest coaching for `initialDebrief` (null if none / for a fresh debrief). */
  initialCoaching: InitialCoaching | null;
}) {
  const draftKey = useMemo(
    () => `critiq:debrief:v1:${accountId}`,
    [accountId],
  );

  const [debrief, setDebrief] = useState<InitialDebrief | null>(
    initialDebrief,
  );
  const [showForm, setShowForm] = useState<boolean>(!initialDebrief);
  const [form, setForm] = useState<FormState>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restore the draft (project rule: rep input persists across reloads).
  useEffect(() => {
    if (initialDebrief) return;
    try {
      const saved = window.localStorage.getItem(draftKey);
      if (saved) setForm(JSON.parse(saved) as FormState);
    } catch {
      /* ignore storage errors */
    }
  }, [draftKey, initialDebrief]);

  useEffect(() => {
    try {
      const hasAny = Object.values(form).some((v) => v && v.trim());
      if (hasAny) window.localStorage.setItem(draftKey, JSON.stringify(form));
    } catch {
      /* ignore storage errors */
    }
  }, [draftKey, form]);

  function setField(key: ReportField, value: string, max: number) {
    setForm((f) => ({ ...f, [key]: value.slice(0, max) }));
  }

  async function generate() {
    setError(null);
    const happened = (form.happened ?? "").trim();
    if (!happened) {
      setError("Tell Critiq what happened on the call first.");
      return;
    }
    setSubmitting(true);
    try {
      const report: FormState = {};
      for (const p of REPORTER_PROMPTS) {
        const v = (form[p.key] ?? "").trim();
        if (v) report[p.key] = v;
      }
      const res = await fetch(`/api/accounts/${accountId}/debrief`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ report }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Couldn't write up the debrief. Try again.");
        return;
      }
      setDebrief(toInitialDebrief(data.debrief));
      setShowForm(false);
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

  if (!showForm && debrief) {
    // Coaching only carries over for the server-loaded debrief; a freshly generated
    // debrief starts with no coaching (its own id, CoachingPanel remounts by key).
    const coachingForView =
      initialDebrief && debrief.id === initialDebrief.id
        ? initialCoaching
        : null;
    return (
      <DebriefView
        accountId={accountId}
        debrief={debrief}
        coaching={coachingForView}
        onDebriefChange={setDebrief}
        onNew={() => {
          setForm({});
          setError(null);
          setShowForm(true);
        }}
      />
    );
  }

  return (
    <div className="mt-8 space-y-6">
      <p className="text-sm leading-relaxed text-slate-600">
        Tell Critiq what happened in your own words — it&apos;ll write up a clean
        recap and flag the commitments and loose ends, so nothing slips and your
        next prep is sharper.
      </p>

      <section className={cardClass}>
        <div className="space-y-6">
          {REPORTER_PROMPTS.map((p) => {
            const value = form[p.key] ?? "";
            return (
              <div key={p.key}>
                <label
                  htmlFor={`debrief-${p.key}`}
                  className="block text-sm font-semibold text-slate-900"
                >
                  {p.label}
                  {!p.required && (
                    <span className="ml-2 font-normal text-slate-400">
                      Optional
                    </span>
                  )}
                </label>
                <p className="mt-1 text-sm text-slate-500">{p.helper}</p>
                <textarea
                  id={`debrief-${p.key}`}
                  value={value}
                  onChange={(e) => setField(p.key, e.target.value, p.max)}
                  disabled={submitting}
                  placeholder={p.placeholder}
                  className={`${textareaClass} mt-3 disabled:opacity-60 ${
                    p.key === "happened" ? "min-h-[160px]" : ""
                  }`}
                  aria-describedby={`debrief-${p.key}-count`}
                />
                <p
                  id={`debrief-${p.key}-count`}
                  className="mt-1 text-right text-xs text-slate-400"
                >
                  {value.length} / {p.max}
                </p>
              </div>
            );
          })}
        </div>

        {!hasSummary && (
          <p className="mt-5 text-sm leading-relaxed text-slate-500">
            Critiq is still getting to know this account, so this debrief leans on
            what you report. It sharpens as you log more calls here.
          </p>
        )}

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
          onClick={generate}
          disabled={submitting}
          aria-busy={submitting}
          className={`${buttonClass} mt-6 flex items-center justify-center gap-2`}
        >
          {submitting && <Spinner />}
          {submitting ? "Writing it up…" : "Write up my debrief"}
        </button>
      </section>
    </div>
  );
}

/* --------------------------- The rendered debrief --------------------------- */

function DebriefView({
  accountId,
  debrief,
  coaching,
  onDebriefChange,
  onNew,
}: {
  accountId: string;
  debrief: InitialDebrief;
  coaching: InitialCoaching | null;
  onDebriefChange: (d: InitialDebrief) => void;
  onNew: () => void;
}) {
  return (
    <div className="mt-8 space-y-6">
      {debrief.summary && (
        <section className="rounded-2xl border border-slate-900 bg-slate-900 p-6 text-white shadow-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-300">
            The takeaway
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-100">
            {debrief.summary}
          </p>
        </section>
      )}

      {debrief.recap && (
        <DebriefCard title="What happened">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
            {debrief.recap}
          </p>
        </DebriefCard>
      )}

      {debrief.observations.length > 0 && (
        <DebriefCard title="What Critiq noticed">
          <ul className="space-y-4">
            {debrief.observations.map((o, i) => (
              <li key={i} className="flex gap-3">
                <LensPill lens={o.lens} />
                <p className="text-sm leading-relaxed text-slate-700">
                  {o.note}
                </p>
              </li>
            ))}
          </ul>
        </DebriefCard>
      )}

      {debrief.commitments.length > 0 && (
        <DebriefCard title="Commitments & next steps">
          <ul className="space-y-2">
            {debrief.commitments.map((c, i) => (
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
        </DebriefCard>
      )}

      {debrief.openQuestions.length > 0 && (
        <DebriefCard title="Loose ends to follow up">
          <ul className="space-y-2">
            {debrief.openQuestions.map((q, i) => (
              <li
                key={i}
                className="flex gap-2 text-sm leading-relaxed text-slate-700"
              >
                <span aria-hidden className="text-slate-400">
                  •
                </span>
                <span>{q}</span>
              </li>
            ))}
          </ul>
        </DebriefCard>
      )}

      <RatingWidget
        accountId={accountId}
        debrief={debrief}
        onDebriefChange={onDebriefChange}
      />

      {debrief.id && (
        <CoachingPanel
          key={debrief.id}
          accountId={accountId}
          debriefId={debrief.id}
          initialCoaching={coaching}
        />
      )}

      <button type="button" onClick={onNew} className={secondaryButtonClass}>
        Debrief another call
      </button>
    </div>
  );
}

function DebriefCard({
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

function LensPill({ lens }: { lens: ObservationLens }) {
  return (
    <span
      className={`mt-0.5 h-fit shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${LENS_PILL_CLASS[lens]}`}
    >
      {LENS_LABELS[lens]}
    </span>
  );
}

function RatingWidget({
  accountId,
  debrief,
  onDebriefChange,
}: {
  accountId: string;
  debrief: InitialDebrief;
  onDebriefChange: (d: InitialDebrief) => void;
}) {
  const [saving, setSaving] = useState(false);
  const current = debrief.usefulnessRating;

  async function rate(value: number) {
    setSaving(true);
    try {
      const res = await fetch(
        `/api/accounts/${accountId}/debrief/${debrief.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ usefulnessRating: value }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) onDebriefChange(toInitialDebrief(data.debrief));
    } catch {
      /* a failed rating is non-critical; leave UI as-is */
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={cardClass}>
      <h2 className="text-sm font-semibold text-slate-900">
        Was this write-up useful?
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Your rating helps Critiq get sharper. 1 = not useful, 5 = nailed it.
      </p>
      <div
        className="mt-4 flex gap-2"
        role="group"
        aria-label="Rate this debrief 1 to 5"
      >
        {[1, 2, 3, 4, 5].map((n) => {
          const selected = current === n;
          return (
            <button
              key={n}
              type="button"
              onClick={() => rate(n)}
              disabled={saving}
              aria-pressed={selected}
              aria-label={`${n} out of 5`}
              className={`h-11 w-11 rounded-lg border text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-1 disabled:opacity-50 ${
                selected
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 text-slate-700 hover:bg-slate-100"
              }`}
            >
              {n}
            </button>
          );
        })}
      </div>
      {current != null && (
        <p className="mt-3 text-sm text-slate-500">
          Thanks — you rated this {current} of 5.
        </p>
      )}
    </section>
  );
}
