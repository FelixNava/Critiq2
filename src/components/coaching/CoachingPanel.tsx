"use client";

import { useState } from "react";
import {
  buttonClass,
  cardClass,
  secondaryButtonClass,
} from "@/components/onboarding/ui";
import { PILLARS, type PillarKey } from "@/lib/scoring/rubric";
import type {
  CoachingLens,
  CoachingPriority,
  CoachingReinforcement,
  ScoreSnapshot,
} from "@/lib/coaching/types";

export interface InitialCoaching {
  id: string;
  priorities: CoachingPriority[];
  reinforce: CoachingReinforcement[];
  nextStep: string | null;
  summary: string | null;
  scoreSnapshot: ScoreSnapshot | null;
  usefulnessRating: number | null;
}

/** Human labels for the coaching lenses (shared vocabulary with the debrief). */
const LENS_LABELS: Record<CoachingLens, string> = {
  structure: "Structure",
  communication: "Communication",
  relationship: "Relationship",
  general: "General",
};

/** Same subtle per-lens tint the debrief uses, so the taxonomy reads consistently. */
const LENS_PILL_CLASS: Record<CoachingLens, string> = {
  structure: "bg-slate-100 text-slate-700",
  communication: "bg-blue-50 text-blue-700",
  relationship: "bg-emerald-50 text-emerald-700",
  general: "bg-slate-100 text-slate-500",
};

/** Coerce a raw coaching row (loose jsonb fields) into a render-safe shape. */
function toInitialCoaching(raw: unknown): InitialCoaching {
  const c = (raw ?? {}) as Partial<InitialCoaching>;
  return {
    id: String(c.id ?? ""),
    priorities: Array.isArray(c.priorities) ? c.priorities : [],
    reinforce: Array.isArray(c.reinforce) ? c.reinforce : [],
    nextStep: c.nextStep ?? null,
    summary: c.summary ?? null,
    scoreSnapshot:
      c.scoreSnapshot && typeof c.scoreSnapshot === "object"
        ? (c.scoreSnapshot as ScoreSnapshot)
        : null,
    usefulnessRating: c.usefulnessRating ?? null,
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

function LensPill({ lens }: { lens: CoachingLens }) {
  return (
    <span
      className={`mt-0.5 h-fit shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${LENS_PILL_CLASS[lens]}`}
    >
      {LENS_LABELS[lens]}
    </span>
  );
}

export default function CoachingPanel({
  accountId,
  debriefId,
  initialCoaching,
}: {
  accountId: string;
  debriefId: string;
  initialCoaching: InitialCoaching | null;
}) {
  const [coaching, setCoaching] = useState<InitialCoaching | null>(
    initialCoaching,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(
        `/api/accounts/${accountId}/debrief/${debriefId}/coaching`,
        { method: "POST", headers: { "content-type": "application/json" } },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          data?.error ?? "Couldn't put together your coaching. Try again.",
        );
        return;
      }
      setCoaching(toInitialCoaching(data.coaching));
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-10 border-t border-slate-200 pt-10">
      <h2 className="text-lg font-semibold text-slate-900">Your coaching</h2>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">
        Now the advice. Critiq reads your debrief
        {coaching?.scoreSnapshot ? " and your call score" : ""} and pulls out the
        few things that&apos;ll move this account forward — plus your next move.
      </p>

      {!coaching ? (
        <div className="mt-6">
          {error && (
            <p
              role="alert"
              className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={generate}
            disabled={loading}
            aria-busy={loading}
            className={`${buttonClass} flex items-center justify-center gap-2`}
          >
            {loading && <Spinner />}
            {loading ? "Coaching the call…" : "Coach this call"}
          </button>
          <p className="mt-3 text-center text-xs text-slate-500">
            Takes a few seconds — Critiq is thinking it through.
          </p>
        </div>
      ) : (
        <CoachingView
          accountId={accountId}
          debriefId={debriefId}
          coaching={coaching}
          onCoachingChange={setCoaching}
          onRecoach={generate}
          recoaching={loading}
          error={error}
        />
      )}
    </div>
  );
}

/* --------------------------- The rendered coaching --------------------------- */

function CoachingView({
  accountId,
  debriefId,
  coaching,
  onCoachingChange,
  onRecoach,
  recoaching,
  error,
}: {
  accountId: string;
  debriefId: string;
  coaching: InitialCoaching;
  onCoachingChange: (c: InitialCoaching) => void;
  onRecoach: () => void;
  recoaching: boolean;
  error: string | null;
}) {
  return (
    <div className="mt-6 space-y-6">
      {coaching.summary && (
        <p className="text-sm font-medium leading-relaxed text-slate-700">
          {coaching.summary}
        </p>
      )}

      {coaching.scoreSnapshot ? (
        <ScoreCard snapshot={coaching.scoreSnapshot} />
      ) : (
        <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-600">
          This call wasn&apos;t recorded, so there&apos;s no scored breakdown —
          your coaching is based on the debrief you wrote.
        </p>
      )}

      {coaching.priorities.length > 0 && (
        <section className={cardClass}>
          <h3 className="text-sm font-semibold text-slate-900">
            Work on this next
          </h3>
          <ol className="mt-4 space-y-5">
            {coaching.priorities.map((p, i) => (
              <li key={i} className="flex gap-3">
                <span
                  aria-hidden
                  className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white"
                >
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">
                      {p.focus}
                    </span>
                    <LensPill lens={p.lens} />
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-slate-700">
                    {p.action}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {coaching.reinforce.length > 0 && (
        <section className={cardClass}>
          <h3 className="text-sm font-semibold text-slate-900">
            What worked — keep doing it
          </h3>
          <ul className="mt-4 space-y-4">
            {coaching.reinforce.map((r, i) => (
              <li key={i} className="flex gap-3">
                <LensPill lens={r.lens} />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">
                    {r.focus}
                  </p>
                  {r.note && r.note !== r.focus && (
                    <p className="mt-0.5 text-sm leading-relaxed text-slate-600">
                      {r.note}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {coaching.nextStep && (
        <section className="rounded-2xl border border-slate-900 bg-slate-900 p-6 text-white shadow-sm">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-300">
            Your next move
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-100">
            {coaching.nextStep}
          </p>
        </section>
      )}

      <CoachingRating
        accountId={accountId}
        debriefId={debriefId}
        coaching={coaching}
        onCoachingChange={onCoachingChange}
      />

      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={onRecoach}
        disabled={recoaching}
        aria-busy={recoaching}
        className={`${secondaryButtonClass} flex items-center justify-center gap-2`}
      >
        {recoaching && <Spinner />}
        {recoaching ? "Re-coaching…" : "Re-coach this call"}
      </button>
    </div>
  );
}

function ScoreCard({ snapshot }: { snapshot: ScoreSnapshot }) {
  const pillarValue: Record<PillarKey, number> = {
    spin: snapshot.spin,
    voss: snapshot.voss,
    navarro: snapshot.navarro,
  };
  return (
    <section className={cardClass}>
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="text-sm font-semibold text-slate-900">
          How the call scored
        </h3>
        <span className="text-sm text-slate-500">
          <span className="text-2xl font-semibold text-slate-900">
            {snapshot.overall}
          </span>{" "}
          / 100
        </span>
      </div>
      <div className="mt-5 space-y-4">
        {(Object.keys(PILLARS) as PillarKey[]).map((key) => {
          const pillar = PILLARS[key];
          const value = pillarValue[key];
          const pct = Math.max(
            0,
            Math.min(100, Math.round((value / pillar.maxPoints) * 100)),
          );
          return (
            <div key={key}>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-slate-700">
                  {pillar.name}
                </span>
                <span className="text-slate-500">
                  {value} / {pillar.maxPoints}
                </span>
              </div>
              <div
                className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100"
                role="progressbar"
                aria-valuenow={value}
                aria-valuemin={0}
                aria-valuemax={pillar.maxPoints}
                aria-label={`${pillar.name} score`}
              >
                <div
                  className="h-full rounded-full bg-slate-900 transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      {snapshot.partialJudgement && (
        <p className="mt-4 text-xs leading-relaxed text-slate-500">
          Part of this call couldn&apos;t be scored, so treat this as a rough
          read.
        </p>
      )}
    </section>
  );
}

function CoachingRating({
  accountId,
  debriefId,
  coaching,
  onCoachingChange,
}: {
  accountId: string;
  debriefId: string;
  coaching: InitialCoaching;
  onCoachingChange: (c: InitialCoaching) => void;
}) {
  const [saving, setSaving] = useState(false);
  const current = coaching.usefulnessRating;

  async function rate(value: number) {
    setSaving(true);
    try {
      const res = await fetch(
        `/api/accounts/${accountId}/debrief/${debriefId}/coaching`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            coachingId: coaching.id,
            usefulnessRating: value,
          }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) onCoachingChange(toInitialCoaching(data.coaching));
    } catch {
      /* a failed rating is non-critical; leave UI as-is */
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={cardClass}>
      <h3 className="text-sm font-semibold text-slate-900">
        Was this coaching useful?
      </h3>
      <p className="mt-1 text-sm text-slate-500">
        Your rating helps Critiq get sharper. 1 = not useful, 5 = nailed it.
      </p>
      <div
        className="mt-4 flex gap-2"
        role="group"
        aria-label="Rate this coaching 1 to 5"
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
