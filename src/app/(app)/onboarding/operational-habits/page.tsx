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

const STORAGE_KEY = "critiq:intake:v1:s2:operational-habits";

const PIPELINE_OPTIONS = [
  {
    value: "crm",
    label: "By the CRM",
    description: "Everything logged and updated, religiously.",
  },
  {
    value: "memory",
    label: "Memory and notes",
    description: "I keep it in my head and a notebook I trust.",
  },
  {
    value: "hybrid",
    label: "A bit of both",
    description: "CRM for the big stuff, instinct for the rest.",
  },
];

export default function OperationalHabitsStepPage() {
  const router = useRouter();
  const [pipelineMethod, setPipelineMethod] = useState("");
  const [accountHabit, setAccountHabit] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Hydrate from localStorage so a back-and-forth doesn't lose answers.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (typeof saved?.pipelineMethod === "string")
          setPipelineMethod(saved.pipelineMethod);
        if (typeof saved?.accountHabit === "string")
          setAccountHabit(saved.accountHabit);
      }
    } catch {
      // Ignore corrupt/unavailable storage — just start fresh.
    }
  }, []);

  // Persist on every change.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ pipelineMethod, accountHabit }),
      );
    } catch {
      // Storage may be full or blocked — non-fatal.
    }
  }, [pipelineMethod, accountHabit]);

  function onContinue() {
    if (!pipelineMethod) {
      setError("Pick the one that fits best to keep going.");
      return;
    }
    setError(null);
    router.push("/onboarding/market-intelligence");
  }

  return (
    <div className={cardClass}>
      <StepProgress current={2} total={3} />

      <div className="mt-6 space-y-6">
        <RadioCardGroup
          name="pipelineMethod"
          legend="How do you run your pipeline?"
          helper="However you actually keep track — not the textbook version."
          options={PIPELINE_OPTIONS}
          value={pipelineMethod}
          onChange={(v) => {
            setPipelineMethod(v);
            if (error) setError(null);
          }}
          error={error ?? undefined}
        />

        <div>
          <label
            htmlFor="accountHabit"
            className="text-base font-semibold text-slate-900"
          >
            What&apos;s one habit that keeps you on top of your accounts?{" "}
            <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <textarea
            id="accountHabit"
            className={textareaClass + " mt-3"}
            value={accountHabit}
            onChange={(e) => setAccountHabit(e.target.value)}
            placeholder="A sentence or two is plenty."
          />
        </div>

        <div className="space-y-3">
          <button type="button" onClick={onContinue} className={buttonClass}>
            Continue →
          </button>
          <Link
            href="/onboarding/sales-psychology"
            className={secondaryButtonClass + " inline-block text-center"}
          >
            ← Back
          </Link>
        </div>
      </div>
    </div>
  );
}
