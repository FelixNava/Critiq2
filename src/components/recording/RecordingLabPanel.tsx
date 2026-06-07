"use client";

import { useRecorder, type ChunkView } from "@/hooks/useRecorder";
import {
  buttonClass,
  cardClass,
  secondaryButtonClass,
} from "@/components/onboarding/ui";
import type { KeepAliveLayers } from "@/lib/recording/sessionKeepAlive";

type Tone = "on" | "off" | "warn" | "error";

const toneClass: Record<Tone, string> = {
  on: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  off: "bg-slate-100 text-slate-500 ring-slate-200",
  warn: "bg-amber-50 text-amber-700 ring-amber-200",
  error: "bg-red-50 text-red-700 ring-red-200",
};

function statusLabel(status: string): { label: string; tone: Tone } {
  switch (status) {
    case "recording":
      return { label: "Recording", tone: "on" };
    case "requesting":
      return { label: "Asking for the microphone", tone: "warn" };
    case "stopped":
      return { label: "Stopped", tone: "off" };
    case "idle":
      return { label: "Ready", tone: "off" };
    case "unsupported":
      return { label: "Not supported here", tone: "warn" };
    case "error":
      return { label: "Problem", tone: "error" };
    default:
      return { label: status, tone: "off" };
  }
}

function chunkTone(state: ChunkView["state"]): { label: string; tone: Tone } {
  switch (state) {
    case "uploaded":
      return { label: "Saved", tone: "on" };
    case "uploading":
      return { label: "Saving", tone: "warn" };
    case "pending":
      return { label: "Waiting", tone: "off" };
    case "failed":
      return { label: "Will retry", tone: "error" };
    default:
      return { label: state, tone: "off" };
  }
}

function keepAliveTone(status: string): Tone {
  if (status === "active") return "on";
  if (status === "suspended" || status === "unsupported") return "warn";
  if (status === "error") return "error";
  return "off";
}

function keepAliveLabel(status: string): string {
  if (status === "active") return "On";
  if (status === "idle" || status === "released") return "Off";
  if (status === "suspended") return "Paused";
  if (status === "unsupported") return "Not available";
  if (status === "error") return "Unavailable";
  return status;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const KEEPALIVE_ROWS: { key: keyof KeepAliveLayers; title: string }[] = [
  { key: "wakeLock", title: "Screen stays awake" },
  { key: "silentAudio", title: "Keeps running in the background" },
  { key: "mediaSession", title: "Lock-screen presence" },
];

export default function RecordingLabPanel() {
  const {
    status,
    recordingId,
    chunks,
    pending,
    keepAlive,
    error,
    busy,
    start,
    stop,
    runSelfTest,
  } = useRecorder();

  const isRecording = status === "recording";
  const s = statusLabel(status);
  const uploaded = chunks.filter((c) => c.state === "uploaded").length;

  return (
    <div className={cardClass}>
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-base font-semibold text-slate-900">Audio capture</h2>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${toneClass[s.tone]}`}
        >
          {s.label}
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        Confirm this device can capture audio and save it reliably. Nothing here
        is part of a live call; it is only a check.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {isRecording ? (
          <button
            type="button"
            onClick={() => void stop()}
            disabled={busy}
            className={buttonClass}
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void start()}
            disabled={busy}
            className={buttonClass}
          >
            Start recording
          </button>
        )}
        <button
          type="button"
          onClick={() => void runSelfTest()}
          disabled={busy || isRecording}
          className={secondaryButtonClass}
        >
          Run upload self-test
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Start recording asks for your microphone. The self-test saves a couple of
        placeholder clips instead, so you can check that uploading works without a
        mic.
      </p>

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
          {error}
        </p>
      )}

      <div className="mt-6">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-900">Clips</p>
          <p className="text-xs text-slate-500">
            {uploaded} saved{pending > 0 ? ` · ${pending} waiting` : ""}
          </p>
        </div>
        {chunks.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">
            No clips yet. Start a recording or run the self-test.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200">
            {chunks.map((c) => {
              const t = chunkTone(c.state);
              return (
                <li
                  key={c.index}
                  className="flex items-center justify-between gap-4 px-4 py-2.5"
                >
                  <span className="text-sm text-slate-700">
                    Clip {c.index + 1}
                    <span className="ml-2 text-xs text-slate-400">
                      {fmtBytes(c.sizeBytes)}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${toneClass[t.tone]}`}
                  >
                    {t.label}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="mt-6">
        <p className="text-sm font-semibold text-slate-900">While recording</p>
        <div className="mt-2 space-y-2">
          {KEEPALIVE_ROWS.map((row) => {
            const value = keepAlive[row.key];
            const tone = keepAliveTone(value);
            return (
              <div
                key={row.key}
                className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 px-4 py-2.5"
              >
                <span className="text-sm text-slate-700">{row.title}</span>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${toneClass[tone]}`}
                >
                  {keepAliveLabel(value)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {recordingId && (
        <p className="mt-4 text-xs text-slate-300">
          Session {recordingId.slice(0, 8)}
        </p>
      )}
    </div>
  );
}
