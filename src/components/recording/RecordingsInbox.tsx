"use client";

import { useId, useState } from "react";
import Link from "next/link";
import {
  toneClass,
  pipelineState,
  fmtDuration,
  fmtRecordingDate,
  recordingLabel,
  coveragePct,
} from "@/components/recording/recordingUi";
import {
  inlineButtonClass,
  inlineSecondaryButtonClass,
  mobileInputClass,
} from "@/components/onboarding/ui";

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
  const coverage = coveragePct(r.durationMs, r.gapMs);
  const hasGaps = (r.gapCount ?? 0) > 0;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href={`/recordings/${r.id}`}
            className="line-clamp-2 text-base font-semibold text-slate-900 underline-offset-2 hover:underline"
            title={recordingLabel(r)}
          >
            {recordingLabel(r)}
          </Link>
          <p className="mt-0.5 text-sm text-slate-500">
            {fmtRecordingDate(r.startedAt)} · {fmtDuration(r.durationMs)}
            {hasGaps && coverage != null && (
              <span className="text-amber-700"> · {coverage}% captured</span>
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
            <span
              aria-hidden
              className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500"
            />
            Unassigned
          </span>
        )}

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`${inlineSecondaryButtonClass} shrink-0`}
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
  // Local accounts list so a just-created account immediately appears in the
  // <select> and resolves in the name lookup, with no navigation or refetch.
  const [accts, setAccts] = useState<InboxAccount[]>(accounts);
  const [accountId, setAccountId] = useState<string>(currentAccountId ?? "");
  const [title, setTitle] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inline create-account state. Start in create mode when the rep has no
  // accounts yet, so the empty case becomes "create + assign" in one flow
  // instead of a dead-end link off /recordings (the assign-flow bug).
  const [creating, setCreating] = useState(accounts.length === 0);
  const [newName, setNewName] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const selectId = useId();
  const titleId = useId();
  const newNameId = useId();

  // Assign the recording to `acctId`. The create flow passes an explicit id
  // (React state isn't synchronous). Reuses the exact same request the normal
  // path fires, so the server's after() pre-warm trigger is unaffected.
  async function submit(explicitAccountId?: string, explicitName?: string) {
    const acctId = explicitAccountId ?? accountId;
    if (!acctId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/recording/${recordingId}/assign-account`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountId: acctId,
          ...(title.trim() ? { title: title.trim() } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Couldn't assign this recording.");
        return;
      }
      // Prefer an explicitly-passed name (the create flow knows it before React
      // state catches up); fall back to the list, then a safe default.
      const name =
        explicitName ?? accts.find((a) => a.id === acctId)?.name ?? "Account";
      onDone(acctId, name, title.trim() ? title.trim() : undefined);
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  // Create a new account, then immediately assign this recording to it — one
  // uninterrupted flow, no navigation away from /recordings. If the assign step
  // fails afterward, the created account is harmless and stays selected to retry.
  async function createAndAssign() {
    const name = newName.trim();
    if (!name || createBusy) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        id?: string;
        error?: string;
      };
      if (!res.ok || !data.id) {
        setCreateError(data.error ?? "Couldn't create that account.");
        return;
      }
      const created = { id: data.id, name };
      setAccts((prev) => [...prev, created]);
      setAccountId(created.id);
      setNewName("");
      setCreating(false);
      await submit(created.id, name);
    } catch {
      setCreateError("Couldn't reach the server. Try again.");
    } finally {
      setCreateBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
      {creating ? (
        <label
          htmlFor={newNameId}
          className="block text-sm font-medium text-slate-700"
        >
          <span className="block">New account name</span>
          <input
            id={newNameId}
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={200}
            autoFocus
            placeholder="e.g. Sherwin Williams — Newark"
            className={`mt-1 ${mobileInputClass}`}
          />
        </label>
      ) : (
        <label
          htmlFor={selectId}
          className="block text-sm font-medium text-slate-700"
        >
          <span className="block">Account</span>
          <select
            id={selectId}
            aria-label="Account"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className={`mt-1 ${mobileInputClass}`}
          >
            <option value="">Choose an account…</option>
            {accts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label
        htmlFor={titleId}
        className="mt-3 block text-sm font-medium text-slate-700"
      >
        <span className="block">
          Name this recording <span className="text-slate-400">(optional)</span>
        </span>
        <input
          id={titleId}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          placeholder="e.g. First call — pricing discussion"
          className={`mt-1 ${mobileInputClass}`}
        />
      </label>

      {creating && createError && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
          {createError}
        </p>
      )}
      {!creating && error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {creating ? (
          <>
            <button
              type="button"
              onClick={() => void createAndAssign()}
              disabled={createBusy || busy || !newName.trim()}
              className={inlineButtonClass}
            >
              {createBusy || busy ? "Creating…" : "Create & assign"}
            </button>
            {accts.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setCreateError(null);
                }}
                className={inlineSecondaryButtonClass}
              >
                Cancel
              </button>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || !accountId}
              className={inlineButtonClass}
            >
              {busy ? "Assigning…" : "Assign"}
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(true);
                setError(null);
              }}
              className="text-sm font-medium text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline"
            >
              + New account
            </button>
          </>
        )}
      </div>
    </div>
  );
}
