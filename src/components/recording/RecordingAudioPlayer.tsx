"use client";

import { useState } from "react";

/**
 * Audio player for a recording's analysis page (Phase 38c). A thin wrapper over
 * the native <audio> element pointed at the server-proxied, Range-capable
 * /api/recording/[id]/audio route (the Blob store is private; bytes are never
 * exposed to the browser directly). Native controls give play/pause/seek/volume
 * for free and work with HTTP Range; the synced scrubber, markers, keyboard
 * shortcuts and speed control are Phase 40.
 *
 * Honest by construction: the real captured duration is shown as a label (a
 * MediaRecorder WebM often lacks a seek index, so the element's own duration can
 * read as unknown until played), gaps are disclosed, and a load failure degrades
 * to a plain message instead of a silent dead control.
 */
export default function RecordingAudioPlayer({
  recordingId,
  durationLabel,
  hasGaps = false,
  coveragePct = null,
}: {
  recordingId: string;
  durationLabel?: string | null;
  hasGaps?: boolean;
  coveragePct?: number | null;
}) {
  const [failed, setFailed] = useState(false);
  const src = `/api/recording/${encodeURIComponent(recordingId)}/audio`;

  if (failed) {
    return (
      <p className="text-sm leading-relaxed text-slate-600" role="status">
        Audio couldn’t be loaded for this call. The transcript and assessment are
        still available below.
      </p>
    );
  }

  return (
    <div>
      <audio
        controls
        preload="metadata"
        src={src}
        onError={() => setFailed(true)}
        className="w-full"
      >
        Your browser can’t play this audio.
      </audio>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        {durationLabel ? <span>Length {durationLabel}</span> : null}
        <span>Audio is private to your account.</span>
      </div>

      {hasGaps && (
        <p className="mt-2 text-xs leading-relaxed text-amber-700">
          Some audio was lost during capture
          {coveragePct != null ? ` (${coveragePct}% captured)` : ""}, so parts of
          the call may be missing from playback.
        </p>
      )}
    </div>
  );
}
