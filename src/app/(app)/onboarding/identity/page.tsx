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

const STORAGE_KEY = "critiq:intake:v1:s1:identity";

const MOTIVATOR_OPTIONS = [
  {
    value: "money",
    label: "Money",
    description: "Earnings and the scoreboard that comes with them.",
  },
  {
    value: "winning",
    label: "Winning",
    description: "Closing the deal, beating the number, coming out on top.",
  },
  {
    value: "freedom",
    label: "Freedom",
    description: "Control over my own time and how I work.",
  },
  {
    value: "recognition",
    label: "Recognition",
    description: "Being seen as one of the best at what I do.",
  },
  {
    value: "impact",
    label: "Impact",
    description: "Genuinely helping customers solve real problems.",
  },
  {
    value: "growth",
    label: "Growth",
    description: "Getting sharper and better every quarter.",
  },
];

export default function IdentityStepPage() {
  const router = useRouter();
  const [motivatorPriority, setMotivatorPriority] = useState("");
  const [legacy, setLegacy] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Hydrate from localStorage so a back-and-forth doesn't lose answers.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (typeof saved?.motivatorPriority === "string")
          setMotivatorPriority(saved.motivatorPriority);
        if (typeof saved?.legacy === "string") setLegacy(saved.legacy);
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
        JSON.stringify({ motivatorPriority, legacy }),
      );
    } catch {
      // Storage may be full or blocked — non-fatal.
    }
  }, [motivatorPriority, legacy]);

  function onContinue() {
    if (!motivatorPriority) {
      setError("Pick the one that fits best to keep going.");
      return;
    }
    setError(null);
    router.push("/onboarding/relationships");
  }

  return (
    <div className={cardClass}>
      <StepProgress current={1} total={2} />

      <div className="mt-6 space-y-6">
        <RadioCardGroup
          name="motivatorPriority"
          legend="What drives you most?"
          helper="Pick the one that rings truest — not the 'right' answer."
          options={MOTIVATOR_OPTIONS}
          value={motivatorPriority}
          onChange={(v) => {
            setMotivatorPriority(v);
            if (error) setError(null);
          }}
          error={error ?? undefined}
        />

        <div>
          <label
            htmlFor="legacy"
            className="text-base font-semibold text-slate-900"
          >
            What do you want to be known for in your territory?{" "}
            <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <textarea
            id="legacy"
            className={textareaClass + " mt-3"}
            value={legacy}
            onChange={(e) => setLegacy(e.target.value)}
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
