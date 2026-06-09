"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import StepProgress from "@/components/onboarding/StepProgress";
import RadioCardGroup from "@/components/onboarding/RadioCardGroup";
import {
  buttonClass,
  cardClass,
  textareaClass,
} from "@/components/onboarding/ui";

const STORAGE_KEY = "critiq:intake:v1:s2:sales-psychology";

const DEAL_STALL_OPTIONS = [
  {
    value: "push",
    label: "Push",
    description: "Create urgency and drive toward a close.",
  },
  {
    value: "pause",
    label: "Pause",
    description: "Give it room and let them come back to me.",
  },
  {
    value: "diagnose",
    label: "Diagnose",
    description: "Dig into what's really blocking it before I move.",
  },
];

export default function SalesPsychologyStepPage() {
  const router = useRouter();
  const [dealStall, setDealStall] = useState("");
  const [stallUnblock, setStallUnblock] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Hydrate from localStorage so a back-and-forth doesn't lose answers.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (typeof saved?.dealStall === "string") setDealStall(saved.dealStall);
        if (typeof saved?.stallUnblock === "string")
          setStallUnblock(saved.stallUnblock);
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
        JSON.stringify({ dealStall, stallUnblock }),
      );
    } catch {
      // Storage may be full or blocked — non-fatal.
    }
  }, [dealStall, stallUnblock]);

  function onContinue() {
    if (!dealStall) {
      setError("Pick the one that fits best to keep going.");
      return;
    }
    setError(null);
    router.push("/onboarding/operational-habits");
  }

  return (
    <div className={cardClass}>
      <StepProgress current={1} total={3} />

      <div className="mt-6 space-y-6">
        <RadioCardGroup
          name="dealStall"
          legend="When a deal stalls, what's your instinct?"
          helper="There's no right answer — go with what you actually do."
          options={DEAL_STALL_OPTIONS}
          value={dealStall}
          onChange={(v) => {
            setDealStall(v);
            if (error) setError(null);
          }}
          error={error ?? undefined}
        />

        <div>
          <label
            htmlFor="stallUnblock"
            className="text-base font-semibold text-slate-900"
          >
            What usually gets a stalled deal moving again?{" "}
            <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <textarea
            id="stallUnblock"
            className={textareaClass + " mt-3"}
            value={stallUnblock}
            onChange={(e) => setStallUnblock(e.target.value)}
            placeholder="A sentence or two is plenty."
          />
        </div>

        <button type="button" onClick={onContinue} className={buttonClass}>
          Continue →
        </button>
      </div>
    </div>
  );
}
