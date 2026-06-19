"use client";

import { useEffect, useId, useState } from "react";
import {
  buttonClass,
  secondaryButtonClass,
  textareaClass,
} from "@/components/onboarding/ui";

/**
 * A small reusable editor for a single free-text "context" block (Phase 35a). Used
 * for both the rep-level context (/profile) and the shared account-level context
 * (the account page) — they're structurally identical: a textarea the rep edits and
 * PUTs to an endpoint that returns `{ context }`.
 *
 * Read mode shows the saved text (or an empty-state hint) with an Edit button; edit
 * mode shows the textarea with Save/Cancel. Saving PUTs `{ context }` and adopts the
 * server's normalized value as the new truth (so a clear/clamp is reflected).
 */
export default function ContextEditor({
  endpoint,
  initialContext,
  max,
  emptyHint,
  placeholder,
  savedLabel = "Saved.",
  ctaLabel = "Add context",
  editLabel = "Edit",
}: {
  /** The route that accepts PUT { context } and returns { ok, context }. */
  endpoint: string;
  initialContext: string | null;
  max: number;
  /** Shown when there's no context yet (cold-start framing, no dev jargon). */
  emptyHint: string;
  placeholder: string;
  savedLabel?: string;
  ctaLabel?: string;
  editLabel?: string;
}) {
  const fieldId = useId();
  const [saved, setSaved] = useState<string | null>(initialContext);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialContext ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  // Keep the draft in sync if the server value changes underneath an idle editor.
  useEffect(() => {
    if (!editing) setDraft(saved ?? "");
  }, [saved, editing]);

  function startEdit() {
    setDraft(saved ?? "");
    setError(null);
    setJustSaved(false);
    setEditing(true);
  }

  async function save() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ context: draft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Couldn't save. Try again.");
        return;
      }
      const next = (typeof data.context === "string" ? data.context : null) || null;
      setSaved(next);
      setEditing(false);
      setJustSaved(true);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!editing) {
    return (
      <div>
        {saved ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
            {saved}
          </p>
        ) : (
          <p className="text-sm leading-relaxed text-slate-500">{emptyHint}</p>
        )}
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={startEdit}
            className="inline-flex min-h-[44px] items-center rounded-lg border border-slate-300 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
          >
            {saved ? editLabel : ctaLabel}
          </button>
          {justSaved && (
            <span className="text-sm text-emerald-600">{savedLabel}</span>
          )}
        </div>
      </div>
    );
  }

  const remaining = max - draft.length;
  return (
    <div>
      <label htmlFor={fieldId} className="sr-only">
        Context
      </label>
      <textarea
        id={fieldId}
        value={draft}
        onChange={(e) => setDraft(e.target.value.slice(0, max))}
        disabled={submitting}
        placeholder={placeholder}
        className={`${textareaClass} min-h-[140px] text-base disabled:opacity-60 sm:text-sm`}
        aria-describedby={`${fieldId}-count`}
        autoFocus
      />
      <p
        id={`${fieldId}-count`}
        className="mt-1 text-right text-xs text-slate-400"
      >
        {remaining} characters left
      </p>

      {error && (
        <p
          role="alert"
          className="mt-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={save}
          disabled={submitting}
          aria-busy={submitting}
          className={`${buttonClass} sm:w-auto sm:px-6`}
        >
          {submitting ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setError(null);
          }}
          disabled={submitting}
          className={`${secondaryButtonClass} sm:w-auto sm:px-6`}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
