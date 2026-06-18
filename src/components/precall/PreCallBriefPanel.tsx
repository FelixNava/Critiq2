"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buttonClass,
  cardClass,
  inputClass,
  secondaryButtonClass,
  textareaClass,
} from "@/components/onboarding/ui";

type ObjectiveMode = "rep" | "signal";

export interface InitialBrief {
  id: string;
  interactionNumber: number;
  narration: string;
  objective: string | null;
  objectiveSource: string;
  recommendedObjective: string | null;
  overridden: boolean;
  diagnosis: string | null;
  approach: { focus: string; why: string }[];
  objections: { objection: string; response: string }[];
  summary: string | null;
  usefulnessRating: number | null;
}

const MAX_NARRATION = 4000;
const MAX_OBJECTIVE = 500;

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

export default function PreCallBriefPanel({
  accountId,
  interactionNumber,
  objectiveMode,
  hasSummary,
  initialBrief,
}: {
  accountId: string;
  interactionNumber: number;
  objectiveMode: ObjectiveMode;
  hasSummary: boolean;
  initialBrief: InitialBrief | null;
}) {
  const draftKey = useMemo(
    () => `critiq:precall:v1:${accountId}`,
    [accountId],
  );

  const [brief, setBrief] = useState<InitialBrief | null>(initialBrief);
  const [showForm, setShowForm] = useState<boolean>(!initialBrief);
  const [narration, setNarration] = useState("");
  const [objective, setObjective] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restore the narration draft (project rule: rep input persists across reloads).
  useEffect(() => {
    if (initialBrief) return;
    try {
      const saved = window.localStorage.getItem(draftKey);
      if (saved) setNarration(saved);
    } catch {
      /* ignore storage errors */
    }
  }, [draftKey, initialBrief]);

  useEffect(() => {
    try {
      if (narration) window.localStorage.setItem(draftKey, narration);
    } catch {
      /* ignore storage errors */
    }
  }, [draftKey, narration]);

  async function generate() {
    setError(null);
    if (!narration.trim()) {
      setError("Add a few notes about the account and this call first.");
      return;
    }
    if (objectiveMode === "rep" && !objective.trim()) {
      setError("Set your objective for this call.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/accounts/${accountId}/pre-call`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          narration: narration.trim(),
          objective: objective.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Couldn't prepare the brief. Try again.");
        return;
      }
      setBrief(data.brief as InitialBrief);
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

  if (!showForm && brief) {
    return (
      <BriefView
        accountId={accountId}
        brief={brief}
        onBriefChange={setBrief}
        onPrepAgain={() => {
          setNarration(brief.narration);
          setObjective(
            brief.objectiveSource === "rep" ? brief.objective ?? "" : "",
          );
          setShowForm(true);
        }}
      />
    );
  }

  return (
    <div className="mt-8 space-y-6">
      <p className="text-sm leading-relaxed text-slate-600">
        Brief Critiq on the account and what you want from this call. It takes
        about two minutes, and you&apos;ll get a quick read on where things stand
        and how to play it.
      </p>

      <section className={cardClass}>
        <label
          htmlFor="precall-narration"
          className="block text-sm font-semibold text-slate-900"
        >
          What&apos;s the situation?
        </label>
        <p className="mt-1 text-sm text-slate-500">
          Recent history, where the relationship stands, what happened last time,
          and what you&apos;re hoping to get from this call.
        </p>
        <textarea
          id="precall-narration"
          value={narration}
          onChange={(e) => setNarration(e.target.value.slice(0, MAX_NARRATION))}
          disabled={submitting}
          placeholder="e.g. Talked to Dana last month about the warehouse repaint. They liked the durability pitch but stalled on price. Calling to firm up a walkthrough date."
          className={`${textareaClass} mt-3 min-h-[140px] disabled:opacity-60`}
          aria-describedby="precall-narration-count"
        />
        <p
          id="precall-narration-count"
          className="mt-1 text-right text-xs text-slate-400"
        >
          {narration.length} / {MAX_NARRATION}
        </p>

        {objectiveMode === "rep" ? (
          <div className="mt-5">
            <label
              htmlFor="precall-objective"
              className="block text-sm font-semibold text-slate-900"
            >
              Your objective for this call
            </label>
            <p className="mt-1 text-sm text-slate-500">
              What does a win look like? Critiq starts suggesting objectives once
              it&apos;s seen a few of your calls on this account.
            </p>
            <input
              id="precall-objective"
              type="text"
              value={objective}
              onChange={(e) =>
                setObjective(e.target.value.slice(0, MAX_OBJECTIVE))
              }
              disabled={submitting}
              placeholder="e.g. Lock in a walkthrough date next week"
              className={`${inputClass} mt-3 disabled:opacity-60`}
            />
          </div>
        ) : (
          <p className="mt-5 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
            Critiq knows this account now — it&apos;ll recommend an objective for
            this call, and you can adjust it.
          </p>
        )}

        {!hasSummary && (
          <p className="mt-5 text-sm leading-relaxed text-slate-500">
            Critiq is still getting to know this account, so this brief leans on
            your notes. It sharpens as you log more calls here.
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
          className={`${buttonClass} mt-6 flex items-center justify-center gap-2`}
        >
          {submitting && <Spinner />}
          {submitting ? "Reading the account…" : "Get my brief"}
        </button>
      </section>
    </div>
  );
}

/* --------------------------- The rendered brief --------------------------- */

function BriefView({
  accountId,
  brief,
  onBriefChange,
  onPrepAgain,
}: {
  accountId: string;
  brief: InitialBrief;
  onBriefChange: (b: InitialBrief) => void;
  onPrepAgain: () => void;
}) {
  return (
    <div className="mt-8 space-y-6">
      {brief.summary && (
        <section className="rounded-2xl border border-slate-900 bg-slate-900 p-6 text-white shadow-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-300">
            The quick read
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-100">
            {brief.summary}
          </p>
        </section>
      )}

      <ObjectiveCard
        accountId={accountId}
        brief={brief}
        onBriefChange={onBriefChange}
      />

      {brief.diagnosis && (
        <BriefCard title="Where this account stands">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
            {brief.diagnosis}
          </p>
        </BriefCard>
      )}

      {brief.approach.length > 0 && (
        <BriefCard title="How to play this call">
          <ul className="space-y-4">
            {brief.approach.map((a, i) => (
              <li key={i}>
                <p className="text-sm font-medium text-slate-900">{a.focus}</p>
                {a.why && (
                  <p className="mt-1 text-sm leading-relaxed text-slate-500">
                    {a.why}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </BriefCard>
      )}

      {brief.objections.length > 0 && (
        <BriefCard title="Be ready for">
          <ul className="space-y-4">
            {brief.objections.map((o, i) => (
              <li key={i}>
                <p className="text-sm font-medium text-slate-900">
                  “{o.objection}”
                </p>
                {o.response && (
                  <p className="mt-1 text-sm leading-relaxed text-slate-500">
                    {o.response}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </BriefCard>
      )}

      <RatingWidget
        accountId={accountId}
        brief={brief}
        onBriefChange={onBriefChange}
      />

      <button type="button" onClick={onPrepAgain} className={secondaryButtonClass}>
        Start a new brief
      </button>
    </div>
  );
}

function BriefCard({
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

function ObjectiveCard({
  accountId,
  brief,
  onBriefChange,
}: {
  accountId: string;
  brief: InitialBrief;
  onBriefChange: (b: InitialBrief) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(brief.objective ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRecommended =
    brief.recommendedObjective != null && !brief.overridden;

  async function save() {
    const trimmed = value.trim();
    if (!trimmed) {
      setError("Objective can't be empty.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/accounts/${accountId}/pre-call/${brief.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ objective: trimmed }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Couldn't save. Try again.");
        return;
      }
      onBriefChange(data.brief as InitialBrief);
      setEditing(false);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={cardClass}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">
          Objective for this call
        </h2>
        {isRecommended ? (
          <span className="shrink-0 rounded-full bg-slate-900 px-2.5 py-0.5 text-xs font-medium text-white">
            Critiq&apos;s recommendation
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
            {brief.overridden ? "Your call" : "Your objective"}
          </span>
        )}
      </div>

      {editing ? (
        <div className="mt-3">
          <label htmlFor="precall-objective-edit" className="sr-only">
            Edit objective
          </label>
          <input
            id="precall-objective-edit"
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value.slice(0, MAX_OBJECTIVE))}
            className={inputClass}
          />
          {error && (
            <p role="alert" className="mt-2 text-sm text-red-700">
              {error}
            </p>
          )}
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save objective"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setValue(brief.objective ?? "");
                setError(null);
              }}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <p className="text-sm leading-relaxed text-slate-700">
            {brief.objective ?? "No objective set."}
          </p>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="mt-3 rounded text-sm font-medium text-slate-600 underline-offset-2 transition hover:text-slate-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-1"
          >
            {isRecommended ? "Set a different objective" : "Edit objective"}
          </button>
        </div>
      )}
    </section>
  );
}

function RatingWidget({
  accountId,
  brief,
  onBriefChange,
}: {
  accountId: string;
  brief: InitialBrief;
  onBriefChange: (b: InitialBrief) => void;
}) {
  const [saving, setSaving] = useState(false);
  const current = brief.usefulnessRating;

  async function rate(value: number) {
    setSaving(true);
    try {
      const res = await fetch(
        `/api/accounts/${accountId}/pre-call/${brief.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ usefulnessRating: value }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) onBriefChange(data.brief as InitialBrief);
    } catch {
      /* a failed rating is non-critical; leave UI as-is */
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={cardClass}>
      <h2 className="text-sm font-semibold text-slate-900">
        Was this brief useful?
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Your rating helps Critiq get sharper. 1 = not useful, 5 = nailed it.
      </p>
      <div className="mt-4 flex gap-2" role="group" aria-label="Rate this brief 1 to 5">
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
