"use client";

import { useState } from "react";
import { useRecorder, type ChunkView } from "@/hooks/useRecorder";
import { usePushAlerts } from "@/hooks/usePushAlerts";
import {
  buttonClass,
  cardClass,
  secondaryButtonClass,
} from "@/components/onboarding/ui";
import type { KeepAliveLayers } from "@/lib/recording/sessionKeepAlive";
import type { HeartbeatState } from "@/lib/recording/segmentedRecorder";

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
    case "recovering":
      return { label: "Recovering", tone: "warn" };
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

function heartbeatTone(hb: HeartbeatState | null): Tone {
  if (!hb) return "off";
  return hb.healthy ? "on" : "warn";
}

function heartbeatLabel(hb: HeartbeatState | null): string {
  if (!hb) return "Starting…";
  if (hb.healthy) return "Healthy";
  if (!hb.trackLive) return "Microphone dropped";
  if (hb.recorderState !== "recording") return "Recorder stalled";
  return "No audio coming in";
}

function fmtAge(ms: number | null): string {
  if (ms == null) return "just now";
  const s = Math.max(0, Math.round(ms / 1000));
  return s <= 1 ? "just now" : `${s}s ago`;
}

function recoveryTone(tier: number): Tone {
  if (tier <= 0) return "off";
  return tier >= 4 ? "error" : "warn";
}

function recoveryLabel(tier: number): string {
  switch (tier) {
    case 0:
      return "Stable";
    case 1:
      return "Restarting the recorder";
    case 2:
      return "Reconnecting the microphone";
    case 3:
      return "Asking for the microphone again";
    case 4:
      return "Needs attention";
    default:
      return "Recovering";
  }
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

function Row({
  title,
  value,
  tone,
}: {
  title: string;
  value: string;
  tone: Tone;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 px-4 py-2.5">
      <span className="text-sm text-slate-700">{title}</span>
      <span
        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${toneClass[tone]}`}
      >
        {value}
      </span>
    </div>
  );
}

export default function RecordingLabPanel() {
  const {
    status,
    recordingId,
    chunks,
    pending,
    keepAlive,
    segment,
    heartbeat,
    recoveryTier,
    recoveryEvents,
    recoveredNote,
    interrupted,
    gapMs,
    gapCount,
    coverage,
    captureLost,
    error,
    busy,
    start,
    stop,
    discard,
    runSelfTest,
  } = useRecorder();
  const push = usePushAlerts();
  const transcribe = useTranscribe(recordingId);

  const isRecording = status === "recording" || status === "recovering";
  const s = statusLabel(status);
  const uploaded = chunks.filter((c) => c.state === "uploaded").length;
  const showHealth = segment.count > 0 || isRecording;
  const coveragePct = Math.round(coverage * 100);
  const gapSeconds = Math.round(gapMs / 1000);

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

      <div className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm ring-1 ring-amber-200">
        <p className="font-semibold text-amber-900">
          On a phone, keep Critiq open with the screen on
        </p>
        <p className="mt-0.5 text-amber-800">
          Phones pause the microphone the moment you lock the screen or switch
          apps, so anything said while you&apos;re away isn&apos;t recorded. For a
          full, reliable recording, use a laptop.
        </p>
      </div>

      {interrupted && (
        <div
          role="alert"
          aria-live="assertive"
          className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm ring-1 ring-red-200"
        >
          <p className="font-semibold text-red-800">Recording paused</p>
          <p className="mt-0.5 text-red-700">
            Critiq lost the microphone — you left the app, locked the screen, or
            another app took it. Come back to Critiq to keep recording; it
            reconnects automatically when the mic is free.
          </p>
        </div>
      )}

      {recoveredNote && (
        <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 ring-1 ring-emerald-200">
          {recoveredNote}
        </p>
      )}

      {gapCount > 0 && (
        <div className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm ring-1 ring-amber-200">
          <p className="font-semibold text-amber-900">
            Only {coveragePct}% of this session was captured
          </p>
          <p className="mt-0.5 text-amber-800">
            About {gapSeconds}s of audio is missing across {gapCount}{" "}
            {gapCount === 1 ? "interruption" : "interruptions"} — the phone
            backgrounded or the screen locked. A recording with gaps isn&apos;t
            reliable for review; re-record with Critiq open and the screen on, or
            use a laptop.
          </p>
        </div>
      )}

      {captureLost && (
        <div
          role="alert"
          aria-live="assertive"
          className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm ring-1 ring-red-200"
        >
          <p className="font-semibold text-red-800">Lost the microphone</p>
          <p className="mt-0.5 text-red-700">
            We couldn&apos;t reconnect. We&apos;re still trying in the background —
            recording resumes on its own if the mic frees up. Keep what
            you&apos;ve recorded so far?
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void stop()}
              disabled={busy}
              className={buttonClass}
            >
              Keep &amp; stop
            </button>
            <button
              type="button"
              onClick={() => void discard()}
              disabled={busy}
              className={secondaryButtonClass}
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {!captureLost && (
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
      )}
      <p className="mt-2 text-xs text-slate-400">
        Start recording asks for your microphone. The self-test saves a couple of
        placeholder clips instead, so you can check that uploading works without a
        mic. Long sessions are saved in ~10-minute parts so nothing is lost.
      </p>

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
          {error}
        </p>
      )}

      {showHealth && (
        <div className="mt-6">
          <p className="text-sm font-semibold text-slate-900">Recording health</p>
          <div className="mt-2 space-y-2">
            <Row
              title="Current part"
              value={`Part ${segment.index + 1}${segment.count > 1 ? ` of ${segment.count}` : ""}`}
              tone="off"
            />
            <Row
              title="Capture heartbeat"
              value={
                heartbeat && heartbeat.healthy
                  ? `Healthy · last clip ${fmtAge(heartbeat.lastChunkAgeMs)}`
                  : heartbeatLabel(heartbeat)
              }
              tone={heartbeatTone(heartbeat)}
            />
            {recoveryTier > 0 && (
              <Row
                title="Recovery"
                value={recoveryLabel(recoveryTier)}
                tone={recoveryTone(recoveryTier)}
              />
            )}
          </div>
          {recoveryEvents.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-slate-500">
              {recoveryEvents.slice(-3).map((ev, i) => (
                <li key={`${ev.at}-${i}`} className="flex items-center gap-2">
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${ev.ok ? "bg-emerald-400" : "bg-amber-400"}`}
                  />
                  {ev.action}
                </li>
              ))}
            </ul>
          )}
        </div>
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
            return <Row key={row.key} title={row.title} value={keepAliveLabel(value)} tone={tone} />;
          })}
        </div>
      </div>

      <div className="mt-6 border-t border-slate-100 pt-6">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-semibold text-slate-900">
            Alerts when you step away
          </p>
          {push.state === "on" && (
            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${toneClass.on}`}
            >
              On
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-slate-500">
          If you leave Critiq while recording, capture pauses — so it plays a
          chime and shows a banner to tell you to come back. Turn on notifications
          for a best-effort lock-screen nudge (a fully locked phone can&apos;t
          always be reached).
        </p>

        {push.state === "checking" && (
          <p className="mt-3 text-sm text-slate-400">Checking this device…</p>
        )}
        {push.state === "off" && (
          <button
            type="button"
            onClick={() => void push.enable()}
            disabled={push.busy}
            className={`${secondaryButtonClass} mt-3`}
          >
            Turn on notifications
          </button>
        )}
        {push.state === "on" && (
          <button
            type="button"
            onClick={() => void push.disable()}
            disabled={push.busy}
            className={`${secondaryButtonClass} mt-3`}
          >
            Turn off notifications
          </button>
        )}
        {push.state === "needs-install" && (
          <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600 ring-1 ring-slate-200">
            To get lock-screen alerts on iPhone, add Critiq to your Home Screen
            first (Share → Add to Home Screen), then open it from there. The
            chime, tab flash, and on-screen banner work either way.
          </p>
        )}
        {push.state === "denied" && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700 ring-1 ring-amber-200">
            Notifications are blocked for Critiq. Allow them in your browser
            settings to get lock-screen alerts. The other alerts still work.
          </p>
        )}
        {push.state === "unsupported" && (
          <p className="mt-3 text-sm text-slate-500">
            This browser can&apos;t show lock-screen alerts. The chime, tab flash,
            and on-screen banner still work.
          </p>
        )}
        {push.message && (
          <p className="mt-2 text-xs text-slate-500">{push.message}</p>
        )}
      </div>

      {recordingId && !isRecording && uploaded > 0 && (
        <div className="mt-6 border-t border-slate-100 pt-6">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm font-semibold text-slate-900">Transcript</p>
            <button
              type="button"
              onClick={() => void transcribe.run()}
              disabled={transcribe.busy}
              className={secondaryButtonClass}
            >
              {transcribe.busy
                ? "Transcribing…"
                : transcribe.text != null
                  ? "Re-transcribe"
                  : "Transcribe"}
            </button>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Turn this recording into text. Long recordings are transcribed in
            parts and stitched together.
          </p>
          {transcribe.error && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
              {transcribe.error}
            </p>
          )}
          {transcribe.text != null && (
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              {transcribe.text.trim() ? (
                <p className="whitespace-pre-wrap text-sm text-slate-700">
                  {transcribe.text}
                </p>
              ) : (
                <p className="text-sm text-slate-400">
                  No speech was detected in this recording.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {recordingId && (
        <p className="mt-4 text-xs text-slate-300">
          Session {recordingId.slice(0, 8)}
        </p>
      )}
    </div>
  );
}

interface TranscriptApiResponse {
  error?: string;
  transcript?: { transcript?: { text?: string | null } };
}

/** Minimal lab-only hook: POST the transcribe trigger and surface the text. */
function useTranscribe(recordingId: string | null) {
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!recordingId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/recording/${recordingId}/transcribe`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as TranscriptApiResponse;
      if (!res.ok) {
        setError(data.error ?? "Couldn't transcribe this recording.");
        return;
      }
      setText(data.transcript?.transcript?.text ?? "");
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return { busy, text, error, run };
}
