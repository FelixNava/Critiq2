"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Refreshes the recording detail page while its pipeline is still advancing
 * (transcribing / scoring). Soft-refreshes the server component on a backoff,
 * caps total attempts so a stuck recording never spins forever, and pauses
 * while the tab is hidden so we never hammer the server in the background.
 *
 * `active` is derived on the server from the pipeline state; when it flips to
 * false (scored / failed / terminal) the effect tears down and polling stops.
 * router.refresh() preserves this component's instance, so the attempt counter
 * survives across refreshes (the cap is real, not reset each tick).
 */
export default function RecordingStatusPoller({ active }: { active: boolean }) {
  const router = useRouter();
  const attempts = useRef(0);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const MAX_ATTEMPTS = 40; // hard cap (~a few minutes with backoff)

    const schedule = () => {
      if (cancelled || attempts.current >= MAX_ATTEMPTS) return;
      // Backoff 4s → 15s; long enough that a ~90s scoring call resolves in a
      // handful of refreshes, short enough to feel live.
      const delay = Math.min(4000 + attempts.current * 2000, 15000);
      timer = setTimeout(() => {
        if (cancelled) return;
        // Tab hidden: skip this refresh but keep the loop alive (no count spent).
        if (typeof document !== "undefined" && document.visibilityState === "hidden") {
          schedule();
          return;
        }
        attempts.current += 1;
        router.refresh();
        schedule();
      }, delay);
    };

    schedule();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [active, router]);

  return null;
}
