"use client";

import { useCallback, useRef, useState } from "react";
import { Zone } from "./analysisZone";
import {
  activeLineIndex,
  type TranscriptLine,
} from "@/lib/recording/transcriptTimeline";

/**
 * Synced playback (Phase 38d): the 38c audio player + a time-anchored,
 * click-to-seek transcript that share ONE <audio> element. Tap a line → the audio
 * seeks to that line's global start; as the audio plays, the active line
 * highlights (and scrolls minimally into view). Speakers are colored + labeled
 * per segment with NEUTRAL labels (never rep-vs-buyer; diarization ids aren't
 * stable across segments — contract §C).
 *
 * Scope: this renders only when the audio is a playable SINGLE segment and the
 * transcript carries word times (the page gates it). The Phase 40 polish —
 * smooth follow-along auto-scroll, timeline markers, in-transcript search,
 * keyboard shortcuts, speed, sticky mini-player, editable speaker labels — is NOT
 * here. On an audio load failure it degrades to a readable (non-clickable)
 * transcript so the read/copy value is never lost.
 */

const SPEAKER_COLORS = [
  "text-indigo-700",
  "text-teal-700",
  "text-amber-700",
  "text-rose-700",
  "text-slate-600",
];

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export default function SyncedPlayback({
  recordingId,
  durationLabel,
  hasGaps,
  coveragePct,
  lines,
  fullText,
  wordCount,
}: {
  recordingId: string;
  durationLabel: string | null;
  hasGaps: boolean;
  coveragePct: number | null;
  lines: TranscriptLine[];
  fullText: string;
  wordCount: number | null;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const lineRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  const src = `/api/recording/${encodeURIComponent(recordingId)}/audio`;

  // speakerKey → color, assigned in first-appearance order (stable per render).
  const colorByKey = new Map<string, string>();
  for (const l of lines) {
    if (!colorByKey.has(l.speakerKey)) {
      colorByKey.set(
        l.speakerKey,
        SPEAKER_COLORS[colorByKey.size % SPEAKER_COLORS.length],
      );
    }
  }
  const speakerLabel = (l: TranscriptLine) =>
    l.speaker == null ? "Speaker" : `Speaker ${l.speaker + 1}`;

  // Highlight the line at the current audio time; follow it (minimally) only
  // while playing so a manual scroll isn't yanked back.
  const syncActive = useCallback(() => {
    const t = audioRef.current?.currentTime ?? 0;
    const next = activeLineIndex(lines, t);
    setActiveIdx((prev) => {
      if (next !== prev && next >= 0 && playing) {
        lineRefs.current[next]?.scrollIntoView({ block: "nearest" });
      }
      return next;
    });
  }, [lines, playing]);

  const seek = (line: TranscriptLine, i: number) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = line.start;
    setActiveIdx(i);
    // Autoplay policy may reject play() — the seek still applied, which is the point.
    void a.play().catch(() => {});
  };

  const copy = () => {
    navigator.clipboard?.writeText(fullText).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      },
      () => {},
    );
  };

  return (
    <>
      <Zone title="Playback">
        {failed ? (
          <p className="text-sm leading-relaxed text-slate-600" role="status">
            Audio couldn’t be loaded for this call. The transcript below is still
            available.
          </p>
        ) : (
          <>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption -- a call recording has no caption track */}
            <audio
              ref={audioRef}
              controls
              preload="metadata"
              src={src}
              onError={() => setFailed(true)}
              onTimeUpdate={syncActive}
              onSeeked={syncActive}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              className="w-full"
            />
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              {durationLabel ? <span>Length {durationLabel}</span> : null}
              <span>Audio is private to your account.</span>
            </div>
            {hasGaps && (
              <p className="mt-2 text-xs leading-relaxed text-amber-700">
                Some audio was lost during capture
                {coveragePct != null ? ` (${coveragePct}% captured)` : ""}, so
                parts of the call may be missing from playback.
              </p>
            )}
          </>
        )}
      </Zone>

      <Zone title="Transcript">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            {wordCount ? `${wordCount} words · ` : ""}
            {failed ? "Read the transcript" : "Tap a line to jump there"}
          </p>
          <button
            type="button"
            onClick={copy}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-600 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
            aria-live="polite"
          >
            {copied ? "Copied ✓" : "Copy transcript"}
          </button>
        </div>

        <div className="mt-2 max-h-[28rem] space-y-0.5 overflow-y-auto rounded-lg bg-slate-50 p-2">
          {lines.map((line, i) => {
            const color = colorByKey.get(line.speakerKey) ?? "text-slate-600";
            const active = i === activeIdx;
            const showSpeaker =
              i === 0 || lines[i - 1].speakerKey !== line.speakerKey;
            const rowClass = `block w-full rounded-md px-2 py-1.5 text-left ${
              active ? "bg-white ring-1 ring-slate-300" : ""
            }`;
            const body = (
              <>
                {showSpeaker && (
                  <span
                    className={`mb-0.5 block text-[11px] font-semibold ${color}`}
                  >
                    {speakerLabel(line)}
                  </span>
                )}
                <span className="flex gap-2">
                  <span className="shrink-0 pt-0.5 text-[11px] tabular-nums text-slate-400">
                    {fmtTime(line.start)}
                  </span>
                  <span className="text-sm leading-relaxed text-slate-700">
                    {line.text}
                  </span>
                </span>
              </>
            );
            return failed ? (
              <div key={i} className={rowClass}>
                {body}
              </div>
            ) : (
              <button
                key={i}
                type="button"
                ref={(el) => {
                  lineRefs.current[i] = el;
                }}
                onClick={() => seek(line, i)}
                aria-current={active ? "true" : undefined}
                className={`${rowClass} transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900`}
              >
                {body}
              </button>
            );
          })}
        </div>
      </Zone>
    </>
  );
}
