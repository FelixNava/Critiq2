"use client";

import { useEffect, useId, useState } from "react";
import {
  buttonClass,
  inlineSecondaryButtonClass,
  secondaryButtonClass,
  textareaClass,
} from "@/components/onboarding/ui";

/** Small inline spinner so an in-flight (multi-second) save reads as working. */
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
  label,
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
  /**
   * The accessible name for the textarea — names THIS surface distinctly (e.g. "How
   * you sell" vs "What you've told Critiq about this account") so a screen-reader
   * user editing the rep profile vs an account note hears which one they're in. The
   * card heading that visually names the surface lives in the parent and isn't
   * programmatically associated, so this prop is the field's real label.
   */
  label: string;
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
            className={inlineSecondaryButtonClass}
          >
            {saved ? editLabel : ctaLabel}
          </button>
          {justSaved && (
            <span role="status" className="text-sm text-emerald-700">
              {savedLabel}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <label htmlFor={fieldId} className="sr-only">
        {label}
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
        {draft.length} / {max}
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
          className={`${buttonClass} flex items-center justify-center gap-2 sm:w-auto sm:px-6`}
        >
          {submitting && <Spinner />}
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
