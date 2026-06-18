"use client";

import { useEffect, useMemo, useState } from "react";
import RadioCardGroup from "@/components/onboarding/RadioCardGroup";
import { cardClass } from "@/components/onboarding/ui";

type StyleMode = "assertive" | "relational";

type CueKind = "emphasis" | "pace" | "pause" | "register" | "silence";

interface DeliveryCue {
  kind: CueKind;
  note: string;
}
interface ScriptLine {
  say: string;
  cues: DeliveryCue[];
}
interface ScriptSection {
  label: string;
  purpose: string;
  lines: ScriptLine[];
}

export interface InitialScript {
  id: string;
  styleMode: string;
  objective: string | null;
  opener: string | null;
  sections: ScriptSection[];
  closing: string | null;
  deliveryNotes: string[];
  usefulnessRating: number | null;
}

const STYLE_LABELS: Record<StyleMode, string> = {
  assertive: "Assertive",
  relational: "Relational",
};
const STYLE_BLURBS: Record<StyleMode, string> = {
  assertive: "Drive toward a decision on this call. Closing-oriented.",
  relational: "Secure the next conversation. Discovery and connection first.",
};

/** Rep-facing labels for the inline delivery cues (no dev jargon). */
const CUE_LABELS: Record<CueKind, string> = {
  emphasis: "Emphasis",
  pace: "Pace",
  pause: "Pause",
  register: "Tone",
  silence: "Silence",
};

function asStyleMode(v: string): StyleMode {
  return v === "assertive" ? "assertive" : "relational";
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

export default function CallScriptPanel({
  accountId,
  briefId,
  baselineStyleMode,
  initialScript,
}: {
  accountId: string;
  briefId: string;
  baselineStyleMode: StyleMode;
  initialScript: InitialScript | null;
}) {
  const draftKey = useMemo(
    () => `critiq:script:v1:mode:${briefId}`,
    [briefId],
  );

  const [script, setScript] = useState<InitialScript | null>(initialScript);
  const [styleMode, setStyleMode] = useState<StyleMode>(
    initialScript ? asStyleMode(initialScript.styleMode) : baselineStyleMode,
  );
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The chosen style mode persists across reloads (project rule: rep selections
  // persist via localStorage). Only restore when there isn't already a script.
  useEffect(() => {
    if (initialScript) return;
    try {
      const saved = window.localStorage.getItem(draftKey);
      if (saved === "assertive" || saved === "relational") setStyleMode(saved);
    } catch {
      /* ignore storage errors */
    }
  }, [draftKey, initialScript]);

  function chooseMode(mode: StyleMode) {
    setStyleMode(mode);
    try {
      window.localStorage.setItem(draftKey, mode);
    } catch {
      /* ignore */
    }
  }

  async function generate() {
    setError(null);
    setGenerating(true);
    try {
      const res = await fetch(
        `/api/accounts/${accountId}/pre-call/${briefId}/script`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ styleMode }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Couldn't write the script. Try again.");
        return;
      }
      setScript(data.script as InitialScript);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <section className="space-y-6">
      <div className="border-t border-slate-200 pt-8">
        <h2 className="text-lg font-semibold text-slate-900">Your call script</h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          A conversation framework with delivery cues, built from this brief and
          your objective. Have it on screen during the call — adapt the lines in
          your own voice.
        </p>
      </div>

      <RadioCardGroup
        name="script-style"
        legend="Pick a style for this call"
        helper="Your baseline, adjustable per call. Critiq writes the whole script in this mode."
        value={styleMode}
        onChange={(v) => chooseMode(asStyleMode(v))}
        options={[
          {
            value: "relational",
            label: STYLE_LABELS.relational,
            description: STYLE_BLURBS.relational,
          },
          {
            value: "assertive",
            label: STYLE_LABELS.assertive,
            description: STYLE_BLURBS.assertive,
          },
        ]}
      />

      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}

      {!script && (
        <button
          type="button"
          onClick={generate}
          disabled={generating}
          className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 disabled:opacity-50"
        >
          {generating && <Spinner />}
          {generating ? "Writing your script…" : "Write my script"}
        </button>
      )}

      {script && (
        <ScriptView
          accountId={accountId}
          briefId={briefId}
          script={script}
          onScriptChange={setScript}
        />
      )}

      {script && (
        <button
          type="button"
          onClick={generate}
          disabled={generating}
          className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 disabled:opacity-50"
        >
          {generating && <Spinner />}
          {generating
            ? "Rewriting…"
            : `Rewrite in ${STYLE_LABELS[styleMode]} mode`}
        </button>
      )}
    </section>
  );
}

function ScriptView({
  accountId,
  briefId,
  script,
  onScriptChange,
}: {
  accountId: string;
  briefId: string;
  script: InitialScript;
  onScriptChange: (s: InitialScript) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-full bg-slate-900 px-2.5 py-0.5 text-xs font-medium text-white">
          {STYLE_LABELS[asStyleMode(script.styleMode)]} mode
        </span>
        {script.objective && (
          <span className="text-xs text-slate-500">
            Targets: {script.objective}
          </span>
        )}
      </div>

      {script.opener && (
        <ScriptCard title="Open with">
          <LineText text={script.opener} />
        </ScriptCard>
      )}

      {script.sections.length > 0 && (
        <div className="space-y-6">
          {script.sections.map((section, i) => (
            <ScriptCard key={i} title={section.label}>
              {section.purpose && (
                <p className="mb-3 text-sm text-slate-500">{section.purpose}</p>
              )}
              <ul className="space-y-4">
                {section.lines.map((line, j) => (
                  <li key={j} className="border-l-2 border-slate-200 pl-4">
                    <LineText text={line.say} />
                    {line.cues.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {line.cues.map((cue, k) => (
                          <CuePill key={k} cue={cue} />
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </ScriptCard>
          ))}
        </div>
      )}

      {script.closing && (
        <ScriptCard title="Close toward your objective">
          <LineText text={script.closing} />
        </ScriptCard>
      )}

      {script.deliveryNotes.length > 0 && (
        <ScriptCard title="Delivery coaching">
          <ul className="space-y-2">
            {script.deliveryNotes.map((note, i) => (
              <li
                key={i}
                className="flex gap-2 text-sm leading-relaxed text-slate-700"
              >
                <span aria-hidden className="text-slate-400">
                  •
                </span>
                <span>{note}</span>
              </li>
            ))}
          </ul>
        </ScriptCard>
      )}

      <ScriptRating
        accountId={accountId}
        briefId={briefId}
        script={script}
        onScriptChange={onScriptChange}
      />
    </div>
  );
}

function ScriptCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cardClass}>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function LineText({ text }: { text: string }) {
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
      {text}
    </p>
  );
}

function CuePill({ cue }: { cue: DeliveryCue }) {
  const label = CUE_LABELS[cue.kind] ?? cue.kind;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
      <span className="font-semibold text-slate-900">{label}</span>
      <span>{cue.note}</span>
    </span>
  );
}

function ScriptRating({
  accountId,
  briefId,
  script,
  onScriptChange,
}: {
  accountId: string;
  briefId: string;
  script: InitialScript;
  onScriptChange: (s: InitialScript) => void;
}) {
  const [saving, setSaving] = useState(false);
  const current = script.usefulnessRating;

  async function rate(value: number) {
    setSaving(true);
    try {
      const res = await fetch(
        `/api/accounts/${accountId}/pre-call/${briefId}/script`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ scriptId: script.id, usefulnessRating: value }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) onScriptChange(data.script as InitialScript);
    } catch {
      /* a failed rating is non-critical; leave UI as-is */
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={cardClass}>
      <h3 className="text-sm font-semibold text-slate-900">
        Will you use this script?
      </h3>
      <p className="mt-1 text-sm text-slate-500">
        Your rating helps Critiq get sharper. 1 = won&apos;t use it, 5 = nailed
        it.
      </p>
      <div
        className="mt-4 flex gap-2"
        role="group"
        aria-label="Rate this script 1 to 5"
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
