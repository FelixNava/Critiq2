"use client";

import Link from "next/link";
import { useRecorder } from "@/hooks/useRecorder";
import { usePushAlerts } from "@/hooks/usePushAlerts";
import { buttonClass, secondaryButtonClass } from "@/components/onboarding/ui";
import {
  toneClass,
  statusLabel,
  keepAliveTone,
  keepAliveLabel,
  heartbeatTone,
  heartbeatLabel,
  fmtAge,
  recoveryTone,
  recoveryLabel,
  KEEPALIVE_ROWS,
  Row,
} from "@/components/recording/recordingUi";

/**
 * Rep-facing capture surface (Phase 34a). Reuses the same useRecorder engine the
 * dev Recording Lab drives — segmented capture, keep-alive, tiered recovery,
 * interruption alerts — but with rep copy (no self-test, no "this is only a
 * check"). A quick-record always starts UNASSIGNED; once it's saved the rep
 * assigns it to an account from their recordings, which is where the coaching
 * comes from.
 */
export default function RecordingPanel() {
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
  } = useRecorder();
  const push = usePushAlerts();

  const isRecording = status === "recording" || status === "recovering";
  const s = statusLabel(status);
  const uploaded = chunks.filter((c) => c.state === "uploaded").length;
  const showHealth = segment.count > 0 || isRecording;
  const coveragePct = Math.round(coverage * 100);
  const gapSeconds = Math.round(gapMs / 1000);
  // A finished capture the rep can now act on (saved at least one clip and isn't
  // mid-session). Drives the "saved — assign it" hand-off to the recordings inbox.
  const saved = !isRecording && !captureLost && uploaded > 0;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-base font-semibold text-slate-900">Record a call</h2>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${toneClass[s.tone]}`}
        >
          {s.label}
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        Capture a conversation and Critiq turns it into coaching. You can record
        now and assign it to an account afterward.
      </p>

      <div className="mt-4 rounded-lg bg-slate-50 px-4 py-3 text-sm ring-1 ring-slate-200">
        <p className="font-medium text-slate-700">
          Make sure everyone on the call knows they&apos;re being recorded.
        </p>
      </div>

      <div className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm ring-1 ring-amber-200">
        <p className="font-semibold text-amber-900">
          On a phone, keep Critiq open with the screen on
        </p>
        <p className="mt-0.5 text-amber-800">
          Phones pause the microphone the moment you lock the screen or switch
          apps, so anything said while you&apos;re away isn&apos;t recorded. For
          a full, reliable recording, use a laptop.
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
            We couldn&apos;t reconnect. We&apos;re still trying in the background
            — recording resumes on its own if the mic frees up. Keep what
            you&apos;ve recorded so far?
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void stop()}
              disabled={busy}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50"
            >
              Keep &amp; stop
            </button>
            <button
              type="button"
              onClick={() => void discard()}
              disabled={busy}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {/* Saved hand-off → assign it to an account in the recordings inbox. */}
      {saved && (
        <div className="mt-6 rounded-lg bg-emerald-50 px-4 py-3 text-sm ring-1 ring-emerald-200">
          <p className="font-semibold text-emerald-900">
            Recording saved{uploaded > 0 ? ` · ${uploaded} clip${uploaded === 1 ? "" : "s"}` : ""}
          </p>
          <p className="mt-0.5 text-emerald-800">
            Assign it to an account to turn it into coaching.
          </p>
          <Link
            href="/recordings"
            className="mt-3 inline-flex items-center gap-1 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
          >
            Go to your recordings →
          </Link>
        </div>
      )}

      {!captureLost && (
        <div className="mt-6">
          {isRecording ? (
            <button
              type="button"
              onClick={() => void stop()}
              disabled={busy}
              className={buttonClass}
            >
              Stop recording
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void start()}
              disabled={busy}
              className={buttonClass}
            >
              {saved ? "Record another" : "Start recording"}
            </button>
          )}
        </div>
      )}
      <p className="mt-2 text-xs text-slate-400">
        Starting asks for your microphone. Long sessions are saved in
        ~10-minute parts so nothing is lost.
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

      {(isRecording || pending > 0) && (
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-900">Clips</p>
            <p className="text-xs text-slate-500">
              {uploaded} saved{pending > 0 ? ` · ${pending} waiting` : ""}
            </p>
          </div>
        </div>
      )}

      <div className="mt-6">
        <p className="text-sm font-semibold text-slate-900">While recording</p>
        <div className="mt-2 space-y-2">
          {KEEPALIVE_ROWS.map((row) => {
            const value = keepAlive[row.key];
            const tone = keepAliveTone(value);
            return (
              <Row
                key={row.key}
                title={row.title}
                value={keepAliveLabel(value)}
                tone={tone}
              />
            );
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
          chime and shows a banner to tell you to come back. Turn on
          notifications for a best-effort lock-screen nudge (a fully locked phone
          can&apos;t always be reached).
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
            This browser can&apos;t show lock-screen alerts. The chime, tab
            flash, and on-screen banner still work.
          </p>
        )}
        {push.message && (
          <p className="mt-2 text-xs text-slate-500">{push.message}</p>
        )}
      </div>

      {recordingId && (
        <p className="mt-4 text-xs text-slate-300">
          Session {recordingId.slice(0, 8)}
        </p>
      )}
    </div>
  );
}
