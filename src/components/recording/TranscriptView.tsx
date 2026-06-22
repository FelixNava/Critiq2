"use client";

import { useState } from "react";

/**
 * Readable + copyable transcript of a finished call (Phase 38). Renders the
 * unified transcript text in a scrollable block with a one-tap Copy button so a
 * rep can read it and paste it elsewhere. The audio-synced / click-to-seek
 * version (highlight the playing line, jump to a moment) is the fuller Phase 38d
 * and depends on the audio player; this is the standalone read/copy slice.
 */
export default function TranscriptView({
  text,
  wordCount,
}: {
  text: string;
  wordCount: number | null;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (permissions / insecure context) — the rep can still
      // select the text manually. Don't surface a scary error for a copy miss.
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          {wordCount ? `${wordCount} words` : "Full transcript"}
        </p>
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-600 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
          aria-live="polite"
        >
          {copied ? "Copied ✓" : "Copy transcript"}
        </button>
      </div>
      <div className="mt-2 max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm leading-relaxed text-slate-700">
        {text}
      </div>
    </div>
  );
}
