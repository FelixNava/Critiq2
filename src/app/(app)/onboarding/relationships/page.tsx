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

const IDENTITY_KEY = "critiq:intake:v1:s1:identity";
const RELATIONSHIPS_KEY = "critiq:intake:v1:s1:relationships";

const LEAD_OR_LISTEN_OPTIONS = [
  {
    value: "lead",
    label: "Lead",
    description: "I set the agenda and drive the conversation.",
  },
  {
    value: "listen",
    label: "Listen",
    description: "I ask, then let them tell me where it goes.",
  },
  {
    value: "depends",
    label: "It depends",
    description: "I read the room and adjust to who's across from me.",
  },
];

export default function RelationshipsStepPage() {
  const router = useRouter();
  const [leadOrListen, setLeadOrListen] = useState("");
  const [secondMeeting, setSecondMeeting] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Hydrate this step's answers from localStorage.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(RELATIONSHIPS_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (typeof saved?.leadOrListen === "string")
          setLeadOrListen(saved.leadOrListen);
        if (typeof saved?.secondMeeting === "string")
          setSecondMeeting(saved.secondMeeting);
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
        RELATIONSHIPS_KEY,
        JSON.stringify({ leadOrListen, secondMeeting }),
      );
    } catch {
      // Non-fatal.
    }
  }, [leadOrListen, secondMeeting]);

  async function onFinish() {
    if (!leadOrListen) {
      setFieldError("Pick the one that fits best to finish up.");
      return;
    }
    setFieldError(null);
    setBanner(null);

    // Step 1 answers must exist — if the rep jumped straight here, send them back.
    let identity: { motivatorPriority?: string; legacy?: string } | null = null;
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(IDENTITY_KEY);
        if (raw) identity = JSON.parse(raw);
      } catch {
        identity = null;
      }
    }
    if (!identity?.motivatorPriority) {
      setBanner(
        "Looks like we missed the first step — let's grab that answer first.",
      );
      router.push("/onboarding/identity");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/intake/session1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identity: {
            motivatorPriority: identity.motivatorPriority,
            legacy: identity.legacy ?? "",
          },
          relationships: { leadOrListen, secondMeeting },
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
          window.localStorage.removeItem(IDENTITY_KEY);
          window.localStorage.removeItem(RELATIONSHIPS_KEY);
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
      <StepProgress current={2} total={2} />

      {banner && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {banner}
        </p>
      )}

      <div className="mt-6 space-y-6">
        <RadioCardGroup
          name="leadOrListen"
          legend="In a first meeting, do you tend to lead or listen?"
          options={LEAD_OR_LISTEN_OPTIONS}
          value={leadOrListen}
          onChange={(v) => {
            setLeadOrListen(v);
            if (fieldError) setFieldError(null);
          }}
          error={fieldError ?? undefined}
        />

        <div>
          <label
            htmlFor="secondMeeting"
            className="text-base font-semibold text-slate-900"
          >
            What makes you want a second meeting with someone?{" "}
            <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <textarea
            id="secondMeeting"
            className={textareaClass + " mt-3"}
            value={secondMeeting}
            onChange={(e) => setSecondMeeting(e.target.value)}
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
            {submitting ? "Saving…" : "Finish intake"}
          </button>
          <Link
            href="/onboarding/identity"
            className={secondaryButtonClass + " inline-block text-center"}
          >
            ← Back
          </Link>
        </div>
      </div>
    </div>
  );
}
