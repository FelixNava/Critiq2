/**
 * Shared presentational helpers for the recording surfaces (the dev Recording Lab
 * and the rep-facing /record panel). Pure status→label/tone mappings plus the
 * small status Row, factored out so both panels render capture health
 * identically without duplicating the mapping logic.
 */
import type { KeepAliveLayers } from "@/lib/recording/sessionKeepAlive";
import type { HeartbeatState } from "@/lib/recording/segmentedRecorder";

export type Tone = "on" | "off" | "warn" | "error";

export const toneClass: Record<Tone, string> = {
  on: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  off: "bg-slate-100 text-slate-500 ring-slate-200",
  warn: "bg-amber-50 text-amber-700 ring-amber-200",
  error: "bg-red-50 text-red-700 ring-red-200",
};

export function statusLabel(status: string): { label: string; tone: Tone } {
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

export function chunkTone(state: string): { label: string; tone: Tone } {
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

export function keepAliveTone(status: string): Tone {
  if (status === "active") return "on";
  if (status === "suspended" || status === "unsupported") return "warn";
  if (status === "error") return "error";
  return "off";
}

export function keepAliveLabel(status: string): string {
  if (status === "active") return "On";
  if (status === "idle" || status === "released") return "Off";
  if (status === "suspended") return "Paused";
  if (status === "unsupported") return "Not available";
  if (status === "error") return "Unavailable";
  return status;
}

export function heartbeatTone(hb: HeartbeatState | null): Tone {
  if (!hb) return "off";
  return hb.healthy ? "on" : "warn";
}

export function heartbeatLabel(hb: HeartbeatState | null): string {
  if (!hb) return "Starting…";
  if (hb.healthy) return "Healthy";
  if (!hb.trackLive) return "Microphone dropped";
  if (hb.recorderState !== "recording") return "Recorder stalled";
  return "No audio coming in";
}

export function fmtAge(ms: number | null): string {
  if (ms == null) return "just now";
  const s = Math.max(0, Math.round(ms / 1000));
  return s <= 1 ? "just now" : `${s}s ago`;
}

export function recoveryTone(tier: number): Tone {
  if (tier <= 0) return "off";
  return tier >= 4 ? "error" : "warn";
}

export function recoveryLabel(tier: number): string {
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

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/* --------- Recording list/picker formatters (shared by the inbox + the --------- *
 * --------- Phase 34d debrief attach-a-recording picker) ----------------------- */

/** The pipeline fields any recording list row carries. */
export type RecordingPipelineInfo = {
  status: string;
  transcriptStatus: string | null;
  scoreStatus: string | null;
  overallScore: number | null;
};

/** Where a recording is in the capture → transcript → score pipeline. */
export function pipelineState(r: RecordingPipelineInfo): {
  label: string;
  tone: Tone;
} {
  if (r.status === "recording") return { label: "In progress", tone: "warn" };
  if (r.scoreStatus === "completed") {
    return {
      label: r.overallScore != null ? `Scored · ${r.overallScore}` : "Scored",
      tone: "on",
    };
  }
  if (r.transcriptStatus === "completed" || r.transcriptStatus === "partial") {
    return { label: "Transcribed", tone: "on" };
  }
  if (r.transcriptStatus === "processing" || r.transcriptStatus === "pending") {
    return { label: "Transcribing", tone: "warn" };
  }
  if (r.scoreStatus === "processing" || r.scoreStatus === "pending") {
    return { label: "Scoring", tone: "warn" };
  }
  return { label: "Saved", tone: "off" };
}

export function fmtDuration(ms: number | null): string {
  if (ms == null || ms <= 0) return "—";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

export function fmtRecordingDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Title if the rep named it, else a "Recording · <date>" fallback. */
export function recordingLabel(r: {
  title: string | null;
  startedAt: string;
}): string {
  return r.title?.trim() ? r.title : `Recording · ${fmtRecordingDate(r.startedAt)}`;
}

export const KEEPALIVE_ROWS: { key: keyof KeepAliveLayers; title: string }[] = [
  { key: "wakeLock", title: "Screen stays awake" },
  { key: "silentAudio", title: "Keeps running in the background" },
  { key: "mediaSession", title: "Lock-screen presence" },
];

export function Row({
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
