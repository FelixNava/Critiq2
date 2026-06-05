"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import StepProgress from "@/components/onboarding/StepProgress";
import RadioCardGroup from "@/components/onboarding/RadioCardGroup";
import {
  buttonClass,
  cardClass,
  secondaryButtonClass,
  textareaClass,
} from "@/components/onboarding/ui";

const SALES_PSYCH_KEY = "critiq:intake:v1:s2:sales-psychology";
const OPS_HABITS_KEY = "critiq:intake:v1:s2:operational-habits";
const MARKET_INTEL_KEY = "critiq:intake:v1:s2:market-intelligence";

const EDGE_SOURCE_OPTIONS = [
  {
    value: "news",
    label: "News and alerts",
    description: "I track what's happening in their industry.",
  },
  {
    value: "relationships",
    label: "Relationships",
    description: "People tell me what's coming before it's public.",
  },
  {
    value: "vendor",
    label: "Vendor intel",
    description: "I lean on supplier and product knowledge.",
  },
];

export default function MarketIntelligenceStepPage() {
  const router = useRouter();
  const [edgeSource, setEdgeSource] = useState("");
  const [bestIntel, setBestIntel] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Hydrate this step's answers from localStorage.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(MARKET_INTEL_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (typeof saved?.edgeSource === "string")
          setEdgeSource(saved.edgeSource);
        if (typeof saved?.bestIntel === "string") setBestIntel(saved.bestIntel);
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
        MARKET_INTEL_KEY,
        JSON.stringify({ edgeSource, bestIntel }),
      );
    } catch {
      // Non-fatal.
    }
  }, [edgeSource, bestIntel]);

  async function onFinish() {
    if (!edgeSource) {
      setFieldError("Pick the one that fits best to finish up.");
      return;
    }
    setFieldError(null);
    setBanner(null);

    // Earlier steps' answers must exist — if the rep jumped straight here,
    // send them back to the first Session 2 step.
    let salesPsychology: {
      dealStall?: string;
      stallUnblock?: string;
    } | null = null;
    let operationalHabits: {
      pipelineMethod?: string;
      accountHabit?: string;
    } | null = null;
    if (typeof window !== "undefined") {
      try {
        const rawSp = window.localStorage.getItem(SALES_PSYCH_KEY);
        if (rawSp) salesPsychology = JSON.parse(rawSp);
        const rawOps = window.localStorage.getItem(OPS_HABITS_KEY);
        if (rawOps) operationalHabits = JSON.parse(rawOps);
      } catch {
        salesPsychology = null;
        operationalHabits = null;
      }
    }
    if (!salesPsychology?.dealStall) {
      setBanner(
        "Looks like we missed an earlier step — let's grab that answer first.",
      );
      router.push("/onboarding/sales-psychology");
      return;
    }
    if (!operationalHabits?.pipelineMethod) {
      setBanner(
        "Looks like we missed a step — let's grab that answer first.",
      );
      router.push("/onboarding/operational-habits");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/intake/session2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          salesPsychology: {
            dealStall: salesPsychology.dealStall,
            stallUnblock: salesPsychology.stallUnblock ?? "",
          },
          operationalHabits: {
            pipelineMethod: operationalHabits.pipelineMethod,
            accountHabit: operationalHabits.accountHabit ?? "",
          },
          marketIntelligence: { edgeSource, bestIntel },
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setBanner(data.error ?? "Something went wrong. Try again.");
        setSubmitting(false);
        return;
      }

      if (typeof window !== "undefined") {
        try {
          window.localStorage.removeItem(SALES_PSYCH_KEY);
          window.localStorage.removeItem(OPS_HABITS_KEY);
          window.localStorage.removeItem(MARKET_INTEL_KEY);
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
      <StepProgress current={3} total={3} />

      {banner && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {banner}
        </p>
      )}

      <div className="mt-6 space-y-6">
        <RadioCardGroup
          name="edgeSource"
          legend="How do you keep an edge on your accounts' world?"
          helper="Where the useful signal actually comes from for you."
          options={EDGE_SOURCE_OPTIONS}
          value={edgeSource}
          onChange={(v) => {
            setEdgeSource(v);
            if (fieldError) setFieldError(null);
          }}
          error={fieldError ?? undefined}
        />

        <div>
          <label
            htmlFor="bestIntel"
            className="text-base font-semibold text-slate-900"
          >
            Where do you get your best intel on an account?{" "}
            <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <textarea
            id="bestIntel"
            className={textareaClass + " mt-3"}
            value={bestIntel}
            onChange={(e) => setBestIntel(e.target.value)}
            placeholder="A sentence or two is plenty."
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
            href="/onboarding/operational-habits"
            className={secondaryButtonClass + " inline-block text-center"}
          >
            ← Back
          </Link>
        </div>
      </div>
    </div>
  );
}
