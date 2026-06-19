"use client";

import { useState } from "react";
import Link from "next/link";
import { toneClass, type Tone } from "@/components/recording/recordingUi";

/** Serialized recording row the inbox renders (startedAt as an ISO string). */
export type InboxRecording = {
  id: string;
  title: string | null;
  status: string;
  startedAt: string;
  durationMs: number | null;
  gapMs: number | null;
  gapCount: number | null;
  chunkCount: number;
  accountId: string | null;
  accountName: string | null;
  transcriptStatus: string | null;
  scoreStatus: string | null;
  overallScore: number | null;
};

export type InboxAccount = { id: string; name: string };

/** Where a recording is in the capture → transcript → score pipeline. */
function pipelineState(r: InboxRecording): { label: string; tone: Tone } {
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
  return { label: "Saved", tone: "off" };
}

function fmtDuration(ms: number | null): string {
  if (ms == null || ms <= 0) return "—";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function defaultLabel(r: InboxRecording): string {
  return r.title?.trim() ? r.title : `Recording · ${fmtDate(r.startedAt)}`;
}

export default function RecordingsInbox({
  recordings,
  accounts,
}: {
  recordings: InboxRecording[];
  accounts: InboxAccount[];
}) {
  const [rows, setRows] = useState<InboxRecording[]>(recordings);

  const patchRow = (id: string, patch: Partial<InboxRecording>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <h2 className="text-base font-semibold text-slate-900">
          No recordings yet
        </h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
          Record a call and it lands here. From here you assign it to an account
          so Critiq can coach you on it.
        </p>
        <Link
          href="/record"
          className="mt-5 inline-flex items-center gap-1 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700"
        >
          Record a call →
        </Link>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.id}>
          <RecordingRow
            recording={r}
            accounts={accounts}
            onAssigned={(accountId, accountName, title) =>
              patchRow(r.id, {
                accountId,
                accountName,
                ...(title !== undefined ? { title } : {}),
              })
            }
          />
        </li>
      ))}
    </ul>
  );
}

function RecordingRow({
  recording: r,
  accounts,
  onAssigned,
}: {
  recording: InboxRecording;
  accounts: InboxAccount[];
  onAssigned: (
    accountId: string,
    accountName: string,
    title?: string | null,
  ) => void;
}) {
  const [open, setOpen] = useState(false);
  const state = pipelineState(r);
  const coveragePct =
    r.durationMs && r.durationMs > 0 && r.gapMs != null
      ? Math.round(((r.durationMs - r.gapMs) / r.durationMs) * 100)
      : null;
  const hasGaps = (r.gapCount ?? 0) > 0;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-slate-900">
            {defaultLabel(r)}
          </p>
          <p className="mt-0.5 text-sm text-slate-500">
            {fmtDate(r.startedAt)} · {fmtDuration(r.durationMs)}
            {hasGaps && coveragePct != null && (
              <span className="text-amber-700"> · {coveragePct}% captured</span>
            )}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${toneClass[state.tone]}`}
        >
          {state.label}
        </span>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        {r.accountId && r.accountName ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
            {r.accountName}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-sm font-medium text-amber-700 ring-1 ring-amber-200">
            Unassigned
          </span>
        )}

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
        >
          {open ? "Cancel" : r.accountId ? "Change account" : "Assign to account"}
        </button>
      </div>

      {open && (
        <AssignControl
          recordingId={r.id}
          accounts={accounts}
          currentAccountId={r.accountId}
          onDone={(accountId, accountName, title) => {
            onAssigned(accountId, accountName, title);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function AssignControl({
  recordingId,
  accounts,
  currentAccountId,
  onDone,
}: {
  recordingId: string;
  accounts: InboxAccount[];
  currentAccountId: string | null;
  onDone: (
    accountId: string,
    accountName: string,
    title?: string | null,
  ) => void;
}) {
  const [accountId, setAccountId] = useState<string>(currentAccountId ?? "");
  const [title, setTitle] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (accounts.length === 0) {
    return (
      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        You don&apos;t have any accounts yet.{" "}
        <Link
          href="/accounts/new"
          className="font-medium text-slate-900 underline underline-offset-2"
        >
          Add an account
        </Link>{" "}
        first, then come back to assign this recording.
      </div>
    );
  }

  async function submit() {
    if (!accountId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/recording/${recordingId}/assign-account`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountId,
          ...(title.trim() ? { title: title.trim() } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Couldn't assign this recording.");
        return;
      }
      const name = accounts.find((a) => a.id === accountId)?.name ?? "Account";
      onDone(accountId, name, title.trim() ? title.trim() : undefined);
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <label className="block text-sm font-medium text-slate-700">
        Account
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900"
        >
          <option value="">Choose an account…</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>

      <label className="mt-3 block text-sm font-medium text-slate-700">
        Name this recording <span className="text-slate-400">(optional)</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          placeholder="e.g. First call — pricing discussion"
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900"
        />
      </label>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
          {error}
        </p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !accountId}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50"
        >
          {busy ? "Assigning…" : "Assign"}
        </button>
        <Link
          href="/accounts/new"
          className="text-sm font-medium text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline"
        >
          + New account
        </Link>
      </div>
    </div>
  );
}
