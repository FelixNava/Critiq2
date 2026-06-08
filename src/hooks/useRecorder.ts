"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  SegmentedRecorder,
  type SegmentedStatus,
  type HeartbeatState,
  type RecoveryEvent,
  type RecoveryTier,
} from "@/lib/recording/segmentedRecorder";
import { ChunkUploader, type ChunkUploadState } from "@/lib/recording/uploader";
import { recoverOrphanedRecordings } from "@/lib/recording/recovery";
import {
  SessionKeepAlive,
  type KeepAliveLayers,
} from "@/lib/recording/sessionKeepAlive";

/**
 * React orchestration for the recorder surface. Ties segmented capture (Phase 13:
 * rotation + heartbeat + tiered recovery) → local persistence + upload (Layers
 * 5-6) → session keep-alive (Layers 1-3) together and exposes the live state the
 * lab UI renders. On mount it also drains any chunks left behind by an interrupted
 * session (resume-after-tab-kill).
 */

export interface ChunkView {
  index: number;
  segmentIndex: number;
  sizeBytes: number;
  state: ChunkUploadState;
}

export interface SegmentView {
  index: number; // current (newest) segment, 0-based
  count: number; // total segments started
}

const IDLE_LAYERS: KeepAliveLayers = {
  wakeLock: "idle",
  silentAudio: "idle",
  mediaSession: "idle",
};

export interface UseRecorder {
  status: SegmentedStatus;
  recordingId: string | null;
  chunks: ChunkView[];
  pending: number;
  keepAlive: KeepAliveLayers;
  segment: SegmentView;
  heartbeat: HeartbeatState | null;
  recoveryTier: RecoveryTier;
  recoveryEvents: RecoveryEvent[];
  recoveredNote: string | null;
  error: string | null;
  busy: boolean;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  runSelfTest: () => Promise<void>;
}

async function apiStart(accountId?: string): Promise<string> {
  const res = await fetch("/api/recording/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(accountId ? { accountId } : {}),
  });
  if (!res.ok) throw new Error(`Could not start the session (${res.status}).`);
  const data = (await res.json()) as { recordingId?: string };
  if (!data.recordingId) throw new Error("No session id was returned.");
  return data.recordingId;
}

async function apiComplete(
  recordingId: string,
  body: { durationMs?: number; chunkCount?: number; status?: string },
): Promise<void> {
  await fetch("/api/recording/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recordingId, ...body }),
  }).catch(() => {
    // Completion is best-effort from the client; the row simply stays open.
  });
}

/** A small synthetic clip for the no-microphone upload self-test. */
function syntheticChunk(): Blob {
  const bytes = new Uint8Array(2048);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 251;
  return new Blob([bytes], { type: "audio/webm" });
}

function mapRecorderError(err: Error): string {
  if (err.name === "NotAllowedError")
    return "Microphone access was blocked. Allow it in your browser and try again.";
  if (err.name === "NotFoundError")
    return "No microphone was found on this device.";
  return "Could not access the microphone.";
}

export function useRecorder(): UseRecorder {
  const recorderRef = useRef<SegmentedRecorder | null>(null);
  const uploaderRef = useRef<ChunkUploader | null>(null);
  const keepAliveRef = useRef<SessionKeepAlive | null>(null);
  const recordingIdRef = useRef<string | null>(null);
  const startedAtRef = useRef<number>(0);
  const chunkTotalRef = useRef<number>(0);
  // In-flight per-chunk handleChunk promises, so finalize() can wait for the tail
  // chunk to persist+upload before it reports the durable count.
  const opsRef = useRef<Promise<unknown>[]>([]);
  // Guards finalize() from running twice (user stop + an auto-stop racing).
  const finalizedRef = useRef<boolean>(false);

  const [status, setStatus] = useState<SegmentedStatus>("idle");
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [chunks, setChunks] = useState<ChunkView[]>([]);
  const [pending, setPending] = useState<number>(0);
  const [keepAlive, setKeepAlive] = useState<KeepAliveLayers>(IDLE_LAYERS);
  const [segment, setSegment] = useState<SegmentView>({ index: 0, count: 0 });
  const [heartbeat, setHeartbeat] = useState<HeartbeatState | null>(null);
  const [recoveryTier, setRecoveryTier] = useState<RecoveryTier>(0);
  const [recoveryEvents, setRecoveryEvents] = useState<RecoveryEvent[]>([]);
  const [recoveredNote, setRecoveredNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);

  const upsertChunk = useCallback(
    (index: number, patch: Partial<ChunkView>) => {
      setChunks((prev) => {
        const i = prev.findIndex((c) => c.index === index);
        if (i === -1) {
          return [
            ...prev,
            { index, segmentIndex: 0, sizeBytes: 0, state: "pending", ...patch },
          ];
        }
        const next = prev.slice();
        next[i] = { ...next[i], ...patch };
        return next;
      });
    },
    [],
  );

  const refreshPending = useCallback(async () => {
    const u = uploaderRef.current;
    if (u) setPending(await u.remaining());
  }, []);

  // Drain the retry queue on reconnect AND when the tab/app becomes visible
  // again. iOS Safari fires the `online` event unreliably (often not at all
  // after airplane mode / backgrounding), so recovery must not depend on it —
  // returning to the app (visibilitychange) reliably fires on iOS and drains
  // any offline-queued chunks.
  useEffect(() => {
    const drain = () => {
      void uploaderRef.current?.flushPending().then(refreshPending);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") drain();
    };
    window.addEventListener("online", drain);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", drain);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshPending]);

  // Resume-after-tab-kill: on mount, drain chunks left by an interrupted session.
  useEffect(() => {
    let cancelled = false;
    void recoverOrphanedRecordings()
      .then((results) => {
        if (cancelled) return;
        const recovered = results.reduce((n, r) => n + r.recovered, 0);
        if (recovered > 0) {
          setRecoveredNote(
            `Recovered ${recovered} clip${recovered === 1 ? "" : "s"} from an interrupted session.`,
          );
        }
      })
      .catch(() => {
        // Best-effort; a later load retries any still-pending chunks.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Tear capture + keep-alive down on unmount.
  useEffect(() => {
    return () => {
      void recorderRef.current?.stop();
      void keepAliveRef.current?.stop();
    };
  }, []);

  const makeUploader = useCallback(
    (id: string) =>
      new ChunkUploader(id, {
        callbacks: {
          onChunkState: (index, state) => {
            upsertChunk(index, { state });
            void refreshPending();
          },
        },
      }),
    [refreshPending, upsertChunk],
  );

  // Post-capture cleanup shared by a user stop AND an auto-stop (hard cap / fatal):
  // wait for every captured chunk to settle, flush the queue, report the durable
  // count, release the keep-alive, and close the session row. Runs at most once.
  const finalize = useCallback(
    async (completeStatus?: string) => {
      if (finalizedRef.current) return;
      finalizedRef.current = true;

      const uploader = uploaderRef.current;
      let chunkCount = chunkTotalRef.current;
      if (uploader) {
        await Promise.allSettled(opsRef.current);
        opsRef.current = [];
        await uploader.flushPending();
        const remaining = await uploader.remaining();
        await refreshPending();
        chunkCount = Math.max(0, chunkTotalRef.current - remaining);
      }

      await keepAliveRef.current?.stop();
      keepAliveRef.current = null;

      const id = recordingIdRef.current;
      if (id) {
        await apiComplete(id, {
          durationMs: Date.now() - startedAtRef.current,
          chunkCount,
          ...(completeStatus ? { status: completeStatus } : {}),
        });
      }
    },
    [refreshPending],
  );

  const start = useCallback(async () => {
    if (busy || recorderRef.current) return;
    setBusy(true);
    setError(null);
    setChunks([]);
    setPending(0);
    setSegment({ index: 0, count: 0 });
    setHeartbeat(null);
    setRecoveryTier(0);
    setRecoveryEvents([]);
    chunkTotalRef.current = 0;
    opsRef.current = [];
    finalizedRef.current = false;
    try {
      const id = await apiStart();
      recordingIdRef.current = id;
      setRecordingId(id);
      startedAtRef.current = Date.now();

      const uploader = makeUploader(id);
      uploaderRef.current = uploader;

      const keepAlive = new SessionKeepAlive((s) => setKeepAlive(s.layers));
      keepAliveRef.current = keepAlive;
      await keepAlive.start();

      const recorder = new SegmentedRecorder({
        onChunk: (c) => {
          chunkTotalRef.current += 1;
          upsertChunk(c.index, {
            segmentIndex: c.segmentIndex,
            sizeBytes: c.blob.size,
            state: "pending",
          });
          const op = uploader
            .handleChunk({
              chunkIndex: c.index,
              segmentIndex: c.segmentIndex,
              blob: c.blob,
              mimeType: c.mimeType,
            })
            .then(async () => {
              // Drain any backlog after EVERY chunk — don't depend on `online`
              // (iOS fires it unreliably). One successful post-reconnect upload
              // carries the offline-queued chunks along.
              if ((await uploader.remaining()) > 0) {
                await uploader.flushPending();
              }
              await refreshPending();
            })
            .catch(() => {
              // Failure is surfaced via onChunkState; don't leave a rejection.
            });
          opsRef.current.push(op);
        },
        onState: (s) => {
          setStatus(s.status);
          setSegment({ index: s.segmentIndex, count: s.segmentCount });
          setHeartbeat(s.heartbeat);
          setRecoveryTier(s.recoveryTier);
        },
        onError: (err) =>
          setError(
            err instanceof Error
              ? mapRecorderError(err)
              : "Could not access the microphone.",
          ),
        onRecovery: (event) =>
          setRecoveryEvents((prev) => [...prev.slice(-9), event]),
        onAutoStop: (reason) => {
          if (reason === "hard-cap") {
            setRecoveredNote("Reached the 75-minute limit — saved and stopped.");
          }
          void finalize(reason === "hard-cap" ? "completed" : "failed");
        },
      });
      recorderRef.current = recorder;
      await recorder.start();

      const st = recorder.getStatus();
      if (st === "error" || st === "unsupported") {
        // Capture never began (permission denied / unsupported) — release the mic
        // and don't leave the keep-alive running or the session row open.
        await recorder.stop();
        await keepAlive.stop();
        keepAliveRef.current = null;
        recorderRef.current = null;
        uploaderRef.current = null;
        recordingIdRef.current = null;
        finalizedRef.current = true;
        await apiComplete(id, { status: "aborted", chunkCount: 0 });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start.");
      await keepAliveRef.current?.stop();
      keepAliveRef.current = null;
      recorderRef.current = null;
      uploaderRef.current = null;
    } finally {
      setBusy(false);
    }
  }, [busy, finalize, makeUploader, refreshPending, upsertChunk]);

  const stop = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await recorderRef.current?.stop();
      recorderRef.current = null;
      await finalize();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not stop cleanly.");
    } finally {
      setBusy(false);
    }
  }, [busy, finalize]);

  const runSelfTest = useCallback(async () => {
    if (busy || recorderRef.current) return;
    setBusy(true);
    setError(null);
    setChunks([]);
    setPending(0);
    opsRef.current = [];
    try {
      const id = await apiStart();
      recordingIdRef.current = id;
      setRecordingId(id);
      const uploader = makeUploader(id);
      uploaderRef.current = uploader;
      setStatus("recording");

      const COUNT = 2;
      for (let i = 0; i < COUNT; i += 1) {
        const blob = syntheticChunk();
        upsertChunk(i, { segmentIndex: 0, sizeBytes: blob.size, state: "pending" });
        await uploader.handleChunk({
          chunkIndex: i,
          segmentIndex: 0,
          blob,
          mimeType: "audio/webm",
        });
      }
      await uploader.flushPending();
      await refreshPending();
      await apiComplete(id, { durationMs: 0, chunkCount: COUNT });
      setStatus("stopped");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Self-test failed.");
      setStatus("error");
    } finally {
      setBusy(false);
    }
  }, [busy, makeUploader, refreshPending, upsertChunk]);

  return {
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
    error,
    busy,
    start,
    stop,
    runSelfTest,
  };
}
