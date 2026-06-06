"use client";

import { useSessionKeepAlive } from "@/hooks/useSessionKeepAlive";
import {
  buttonClass,
  cardClass,
  secondaryButtonClass,
} from "@/components/onboarding/ui";
import type { KeepAliveLayers } from "@/lib/recording/sessionKeepAlive";

type Tone = "on" | "off" | "warn" | "error";

function describe(status: string): { label: string; tone: Tone } {
  switch (status) {
    case "active":
      return { label: "Active", tone: "on" };
    case "suspended":
      return { label: "Tap start again", tone: "warn" };
    case "released":
    case "idle":
      return { label: "Off", tone: "off" };
    case "unsupported":
      return { label: "Not available on this device", tone: "warn" };
    case "error":
      return { label: "Unavailable", tone: "error" };
    default:
      return { label: status, tone: "off" };
  }
}

const toneClass: Record<Tone, string> = {
  on: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  off: "bg-slate-100 text-slate-500 ring-slate-200",
  warn: "bg-amber-50 text-amber-700 ring-amber-200",
  error: "bg-red-50 text-red-700 ring-red-200",
};

const LAYER_ROWS: {
  key: keyof KeepAliveLayers;
  title: string;
  help: string;
}[] = [
  {
    key: "wakeLock",
    title: "Screen stays awake",
    help: "Keeps your display from sleeping during a live session.",
  },
  {
    key: "silentAudio",
    title: "Keeps running in the background",
    help: "Holds the session open when the app isn't in front. You won't hear anything.",
  },
  {
    key: "mediaSession",
    title: "Lock-screen presence",
    help: "Shows neutral Critiq branding on your lock screen — nothing about what's happening.",
  },
];

export default function DeviceCheckPanel() {
  const { active, layers, start, stop } = useSessionKeepAlive();

  return (
    <div className={cardClass}>
      <h2 className="text-base font-semibold text-slate-900">
        Session readiness
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        These are the background pieces Critiq uses to hold a live session open.
        No audio is captured here — this just checks your device can keep one
        running.
      </p>

      <div className="mt-6 space-y-3">
        {LAYER_ROWS.map((row) => {
          const { label, tone } = describe(layers[row.key]);
          return (
            <div
              key={row.key}
              className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 p-4"
            >
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {row.title}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                  {row.help}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${toneClass[tone]}`}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-6">
        {active ? (
          <button
            type="button"
            onClick={() => void stop()}
            className={secondaryButtonClass}
          >
            Stop check
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void start()}
            className={buttonClass}
          >
            Start check
          </button>
        )}
      </div>

      <p className="mt-3 text-xs text-slate-400">
        {active
          ? "Holding your session open. Lock your screen or switch apps to test it, then come back."
          : "Tap start, then lock your screen or switch apps for a moment to confirm it holds."}
      </p>
    </div>
  );
}
