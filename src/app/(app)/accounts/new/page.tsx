"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ACCOUNT_STAGES, DEFAULT_STAGE } from "@/lib/accounts";
import {
  buttonClass,
  inputClass,
  secondaryButtonClass,
} from "@/components/onboarding/ui";

export default function NewAccountPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [stage, setStage] = useState<string>(DEFAULT_STAGE);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give the account a name.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, stage }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Something went wrong. Try again.");
        setSubmitting(false);
        return;
      }
      router.push("/accounts");
      router.refresh();
    } catch {
      setError("Something went wrong. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-dvh bg-slate-50 px-4 py-12">
      <div className="mx-auto w-full max-w-md">
        <h1 className="text-2xl font-semibold text-slate-900">New account</h1>
        <p className="mt-1 text-sm text-slate-500">
          Just a name to start — you can flesh it out as you go.
        </p>

        <form
          onSubmit={onSubmit}
          className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
        >
          <div>
            <label
              htmlFor="name"
              className="text-sm font-semibold text-slate-900"
            >
              Account name
            </label>
            <input
              id="name"
              className={inputClass + " mt-2"}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              placeholder="e.g. Riverside Contractors"
              autoFocus
              maxLength={200}
            />
          </div>

          <div className="mt-5">
            <label
              htmlFor="stage"
              className="text-sm font-semibold text-slate-900"
            >
              Stage
            </label>
            <select
              id="stage"
              className={inputClass + " mt-2"}
              value={stage}
              onChange={(e) => setStage(e.target.value)}
            >
              {ACCOUNT_STAGES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

          <div className="mt-6 space-y-3">
            <button
              type="submit"
              disabled={submitting}
              className={buttonClass}
            >
              {submitting ? "Saving…" : "Create account"}
            </button>
            <button
              type="button"
              onClick={() => router.push("/accounts")}
              className={secondaryButtonClass}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
