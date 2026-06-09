"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import RadioCardGroup from "@/components/onboarding/RadioCardGroup";
import {
  buttonClass,
  cardClass,
  secondaryButtonClass,
  textareaClass,
} from "@/components/onboarding/ui";

const DRAFT_KEY = "critiq:intake:v1:life-context";

const LIFE_SEASON_OPTIONS = [
  {
    value: "building",
    label: "Building",
    description: "Heads-down, growing my book.",
  },
  {
    value: "steady",
    label: "Steady",
    description: "Consistent — protecting and deepening what I have.",
  },
  {
    value: "stretched",
    label: "Stretched",
    description: "A lot on my plate outside of work right now.",
  },
  {
    value: "reset",
    label: "Reset",
    description: "Recently changed something big — role, territory, or life.",
  },
];

export default function LifeContextForm() {
  const router = useRouter();
  const [lifeSeason, setLifeSeason] = useState("");
  const [outsideContext, setOutsideContext] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Hydrate from localStorage.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (typeof saved?.lifeSeason === "string")
          setLifeSeason(saved.lifeSeason);
        if (typeof saved?.outsideContext === "string")
          setOutsideContext(saved.outsideContext);
      }
    } catch {
      // Ignore corrupt/unavailable storage.
    }
  }, []);

  // Persist on every change.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ lifeSeason, outsideContext }),
      );
    } catch {
      // Non-fatal.
    }
  }, [lifeSeason, outsideContext]);

  async function onFinish() {
    if (!lifeSeason) {
      setFieldError("Pick the one that fits best to finish up.");
      return;
    }
    setFieldError(null);
    setBanner(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/intake/life-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lifeContext: { lifeSeason, outsideContext } }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setBanner(data.error ?? "Something went wrong. Try again.");
        setSubmitting(false);
        return;
      }

      if (typeof window !== "undefined") {
        try {
          window.localStorage.removeItem(DRAFT_KEY);
        } catch {
          // Non-fatal.
        }
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setBanner("Something went wrong. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className={cardClass}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        One more thing
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-slate-900">
        A little life context
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-slate-600">
        You&apos;ve been at this a bit now, so here&apos;s the last piece. This
        one&apos;s more personal — it helps Critiq coach the person, not just the
        pipeline. Share only what you&apos;re comfortable with.
      </p>

      {banner && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {banner}
        </p>
      )}

      <div className="mt-6 space-y-6">
        <RadioCardGroup
          name="lifeSeason"
          legend="What season are you in right now?"
          helper="It helps Critiq match the intensity of its coaching to your life, not just your numbers."
          options={LIFE_SEASON_OPTIONS}
          value={lifeSeason}
          onChange={(v) => {
            setLifeSeason(v);
            if (fieldError) setFieldError(null);
          }}
          error={fieldError ?? undefined}
        />

        <div>
          <label
            htmlFor="outsideContext"
            className="text-base font-semibold text-slate-900"
          >
            Anything outside the numbers you&apos;d want a coach to know?{" "}
            <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <textarea
            id="outsideContext"
            className={textareaClass + " mt-3"}
            value={outsideContext}
            onChange={(e) => setOutsideContext(e.target.value)}
            placeholder="Totally optional, and only what you're comfortable sharing."
          />
        </div>

        <div className="space-y-3">
          <button
            type="button"
            onClick={onFinish}
            disabled={submitting}
            className={buttonClass}
          >
            {submitting ? "Saving…" : "Finish"}
          </button>
          <Link
            href="/dashboard"
            className={secondaryButtonClass + " inline-block text-center"}
          >
            ← Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
