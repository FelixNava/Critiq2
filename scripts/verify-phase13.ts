/**
 * Phase 13 unit verification — auto-segmentation + heartbeat + tiered recovery +
 * resume-after-tab-kill, all against a FAKE clock + FAKE media engine + a fake
 * IndexedDB. Imports the REAL app modules (no re-implementation, per the standing
 * rule) and drives time deterministically — the parts a device gate can't make
 * repeatable. Real mic capture / segment rotation over real minutes stays an
 * on-device gate (Felix).
 *
 * Run: pnpm tsx scripts/verify-phase13.ts
 */
import "fake-indexeddb/auto";

import {
  SegmentedRecorder,
  type RecorderEngine,
  type RecorderTimers,
  type SegmentRecorderHandle,
  type SegmentRecorderOptions,
  type MicStream,
  type AutoStopReason,
  type TimerHandle,
} from "../src/lib/recording/segmentedRecorder";
import type { RecorderChunk } from "../src/lib/recording/recorder";

const fails: string[] = [];
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) fails.push(msg);
};

/** Flush all pending microtasks via one REAL macrotask. */
const realTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Deterministic, advanceable timers implementing the injected RecorderTimers. */
class FakeTimers implements RecorderTimers {
  private t = 0;
  private seq = 1;
  private timeouts: { id: number; at: number; fn: () => void }[] = [];
  private intervals: { id: number; every: number; next: number; fn: () => void }[] = [];

  now(): number {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number): TimerHandle {
    const id = this.seq++;
    this.timeouts.push({ id, at: this.t + ms, fn });
    return id;
  }
  clearTimeout(h: TimerHandle): void {
    this.timeouts = this.timeouts.filter((x) => x.id !== h);
  }
  setInterval(fn: () => void, ms: number): TimerHandle {
    const id = this.seq++;
    this.intervals.push({ id, every: ms, next: this.t + ms, fn });
    return id;
  }
  clearInterval(h: TimerHandle): void {
    this.intervals = this.intervals.filter((x) => x.id !== h);
  }

  /** Advance the fake clock to now+ms, firing due timers in order + flushing async. */
  async advance(ms: number): Promise<void> {
    const target = this.t + ms;
    for (;;) {
      const nextT = this.timeouts
        .filter((x) => x.at <= target)
        .reduce((m, x) => Math.min(m, x.at), Infinity);
      const nextI = this.intervals
        .filter((x) => x.next <= target)
        .reduce((m, x) => Math.min(m, x.next), Infinity);
      const at = Math.min(nextT, nextI);
      if (!isFinite(at)) break;
      this.t = at;
      const dueT = this.timeouts.filter((x) => x.at === at);
      for (const d of dueT) {
        this.timeouts = this.timeouts.filter((x) => x !== d);
        d.fn();
        await realTick();
      }
      const dueI = this.intervals.filter((x) => x.next === at);
      for (const d of dueI) {
        d.next += d.every;
        d.fn();
        await realTick();
      }
    }
    this.t = target;
  }
}

class FakeRec implements SegmentRecorderHandle {
  state: "recording" | "paused" | "inactive" = "inactive";
  emitted = 0;
  constructor(private readonly opts: SegmentRecorderOptions) {}
  start(): void {
    this.state = "recording";
  }
  async stop(): Promise<void> {
    this.state = "inactive";
  }
  getState() {
    return this.state;
  }
  emit(size = 128): void {
    this.opts.onChunk(
      new Blob([new Uint8Array(size)], { type: "audio/webm" }),
      "audio/webm",
    );
    this.emitted += 1;
  }
}

function makeFakeEngine() {
  const recorders: FakeRec[] = [];
  let trackLive = true;
  let acquireCount = 0;
  let failNextAcquire = false;
  const engine: RecorderEngine = {
    isSupported: () => true,
    pickMimeType: () => "audio/webm",
    async acquireStream(): Promise<MicStream> {
      acquireCount += 1;
      if (failNextAcquire) {
        failNextAcquire = false;
        throw new Error("permission denied");
      }
      return { isLive: () => trackLive, stop: () => {} };
    },
    createSegmentRecorder(_stream, opts): SegmentRecorderHandle {
      const r = new FakeRec(opts);
      recorders.push(r);
      return r;
    },
  };
  return {
    engine,
    recorders,
    current: () => recorders[recorders.length - 1],
    setTrackLive: (v: boolean) => {
      trackLive = v;
    },
    failNextAcquire: () => {
      failNextAcquire = true;
    },
    acquireCount: () => acquireCount,
  };
}

async function main() {
  // ============================================================
  // A. Segmentation: rotation, 2s overlap, per-segment tagging, hard cap.
  // ============================================================
  {
    const timers = new FakeTimers();
    const fe = makeFakeEngine();
    const chunks: RecorderChunk[] = [];
    const rec = new SegmentedRecorder(
      { onChunk: (c) => chunks.push(c) },
      {
        engine: fe.engine,
        timers,
        // small, fast config: 1s segments, 0.2s overlap, no heartbeat interference
        config: {
          segmentMs: 1000,
          overlapMs: 200,
          hardCapMs: 60_000,
          timesliceMs: 100,
          heartbeatMs: 1_000_000,
          stallMs: 1_000_000,
        },
      },
    );
    await rec.start();
    ok(rec.getStatus() === "recording", "segment: start → recording");
    ok(fe.recorders.length === 1, "segment: one recorder for segment 0");

    fe.recorders[0].emit();
    ok(
      chunks.length === 1 && chunks[0].index === 0 && chunks[0].segmentIndex === 0,
      "segment: first chunk tagged index 0 / segment 0",
    );

    // Rotate: next segment starts segmentMs-overlapMs (=800ms) in.
    await timers.advance(800);
    ok(fe.recorders.length === 2, "segment: rotation started a 2nd recorder");
    ok(
      rec.getState().segmentIndex === 1 && rec.getState().segmentCount === 2,
      "segment: segmentIndex→1, segmentCount→2",
    );
    ok(
      fe.recorders[0].getState() === "recording",
      "segment: OVERLAP — the outgoing recorder is still capturing",
    );
    ok(
      fe.recorders[1].getState() === "recording",
      "segment: the incoming recorder is capturing too",
    );

    // During overlap, the OLD recorder's chunk keeps the OLD segment index.
    fe.recorders[0].emit();
    fe.recorders[1].emit();
    const overlapOld = chunks[chunks.length - 2];
    const overlapNew = chunks[chunks.length - 1];
    ok(
      overlapOld.segmentIndex === 0 && overlapNew.segmentIndex === 1,
      "segment: overlap chunks keep their own segment index (0 vs 1)",
    );
    ok(
      overlapOld.index === 1 && overlapNew.index === 2,
      "segment: chunk index stays globally monotonic across segments",
    );

    // After the overlap window the outgoing recorder is stopped.
    await timers.advance(200);
    ok(
      fe.recorders[0].getState() === "inactive",
      "segment: outgoing recorder stops after the 2s overlap",
    );
    ok(
      fe.recorders[1].getState() === "recording",
      "segment: the new segment keeps recording after cutover",
    );

    await rec.stop();
    ok(rec.getStatus() === "stopped", "segment: stop → stopped");
  }

  // Hard cap.
  {
    const timers = new FakeTimers();
    const fe = makeFakeEngine();
    let autoStop: AutoStopReason | null = null;
    const rec = new SegmentedRecorder(
      { onChunk: () => {}, onAutoStop: (r) => (autoStop = r) },
      {
        engine: fe.engine,
        timers,
        config: {
          segmentMs: 100_000, // no rotation in-window
          overlapMs: 200,
          hardCapMs: 1000,
          timesliceMs: 100,
          heartbeatMs: 1_000_000,
          stallMs: 1_000_000,
        },
      },
    );
    await rec.start();
    await timers.advance(1000);
    ok(autoStop === "hard-cap", "hard cap: auto-stops at the cap with reason 'hard-cap'");
    ok(rec.getStatus() === "stopped", "hard cap: status → stopped");
  }

  // ============================================================
  // B. Heartbeat + tiered recovery.
  // ============================================================
  {
    const timers = new FakeTimers();
    const fe = makeFakeEngine();
    const events: { tier: number; ok: boolean }[] = [];
    const rec = new SegmentedRecorder(
      {
        onChunk: () => {},
        onRecovery: (e) => events.push({ tier: e.tier, ok: e.ok }),
      },
      {
        engine: fe.engine,
        timers,
        config: {
          segmentMs: 1_000_000, // no rotation
          overlapMs: 200,
          hardCapMs: 1_000_000,
          timesliceMs: 100,
          heartbeatMs: 1000,
          stallMs: 5000,
        },
      },
    );
    await rec.start();
    fe.current().emit(); // a healthy chunk so lastChunkAt is set

    // Healthy beat — no recovery.
    await timers.advance(1000);
    ok(rec.getState().recoveryTier === 0, "heartbeat: healthy beat → no recovery");

    // Tier 1: the recorder dies (state inactive) but the track is live.
    fe.current().state = "inactive";
    await timers.advance(1000);
    ok(
      rec.getState().recoveryTier === 1 && rec.getStatus() === "recovering",
      "recovery: dead recorder + live track → Tier 1 (restart recorder)",
    );
    // Tier 1 created a fresh recorder; a chunk from it means health restored.
    fe.current().emit();
    await timers.advance(1000);
    ok(
      rec.getState().recoveryTier === 0 && rec.getStatus() === "recording",
      "recovery: capture resumed → tier resets to 0, back to recording",
    );

    // Tier escalation: the mic track dies and re-acquire keeps failing.
    fe.setTrackLive(false);
    await timers.advance(1000); // beat → unhealthy (track dead) → Tier 2
    ok(rec.getState().recoveryTier === 2, "recovery: dead track → Tier 2 (re-acquire stream)");
    await timers.advance(1000); // still dead → Tier 3
    ok(rec.getState().recoveryTier === 3, "recovery: still down → Tier 3 (re-prompt mic)");
    await timers.advance(1000); // still dead → Tier 4 (notify)
    ok(rec.getState().recoveryTier === 4, "recovery: still down → Tier 4 (notify)");
    ok(
      events.some((e) => e.tier === 4 && e.ok === false),
      "recovery: Tier 4 fires an 'exhausted' recovery event",
    );
    await timers.advance(1000); // stays at Tier 4 — no infinite escalation
    ok(rec.getState().recoveryTier === 4, "recovery: caps at Tier 4 (no runaway escalation)");

    // Manual fix: track returns + a chunk flows → full recovery from Tier 4.
    fe.setTrackLive(true);
    fe.current().emit();
    await timers.advance(1000);
    ok(
      rec.getState().recoveryTier === 0 && rec.getStatus() === "recording",
      "recovery: a manual fix after Tier 4 still recovers on a later beat",
    );
    await rec.stop();
  }

  // ============================================================
  // C. Resume-after-tab-kill: drain orphaned chunks left in IndexedDB.
  // ============================================================
  {
    const store = await import("../src/lib/recording/chunkStore");
    const { ChunkUploader } = await import("../src/lib/recording/uploader");
    const { recoverOrphanedRecordings } = await import(
      "../src/lib/recording/recovery"
    );

    const mkBlob = (n: number) =>
      new Blob([new Uint8Array(n)], { type: "audio/webm" });

    // Two orphaned recordings + one "active" we exclude.
    await store.saveChunk({ recordingId: "orphan-A", chunkIndex: 0, segmentIndex: 0, blob: mkBlob(50), mimeType: "audio/webm" });
    await store.saveChunk({ recordingId: "orphan-A", chunkIndex: 1, segmentIndex: 0, blob: mkBlob(60), mimeType: "audio/webm" });
    await store.saveChunk({ recordingId: "orphan-B", chunkIndex: 0, segmentIndex: 1, blob: mkBlob(70), mimeType: "audio/webm" });
    await store.saveChunk({ recordingId: "active-1", chunkIndex: 0, segmentIndex: 0, blob: mkBlob(80), mimeType: "audio/webm" });

    const ids = await store.listRecordingIdsWithPending();
    ok(
      ids.sort().join(",") === "active-1,orphan-A,orphan-B",
      "orphan: listRecordingIdsWithPending finds all recordings with pending chunks",
    );

    const completed: { id: string; allUploaded: boolean }[] = [];
    const good = async (_b: Blob, pathname: string) => ({
      url: `https://x.blob.vercel-storage.com/${pathname}`,
      pathname,
    });

    const results = await recoverOrphanedRecordings({
      excludeRecordingId: "active-1",
      deps: {
        makeUploader: (id) => new ChunkUploader(id, { uploadFn: good }),
        complete: async (id, allUploaded) => {
          completed.push({ id, allUploaded });
        },
      },
    });

    ok(
      results.length === 2,
      "orphan: recovers both orphans, skips the excluded active recording",
    );
    ok(
      (await store.pendingCount("orphan-A")) === 0 &&
        (await store.pendingCount("orphan-B")) === 0,
      "orphan: drained orphan queues are empty (chunks uploaded + evicted)",
    );
    ok(
      (await store.pendingCount("active-1")) === 1,
      "orphan: the excluded active recording is left untouched",
    );
    ok(
      completed.length === 2 && completed.every((c) => c.allUploaded),
      "orphan: each fully-drained orphan is marked complete (allUploaded=true)",
    );

    // A still-offline orphan stays queued + is marked not-fully-uploaded.
    await store.saveChunk({ recordingId: "orphan-C", chunkIndex: 0, segmentIndex: 0, blob: mkBlob(90), mimeType: "audio/webm" });
    const completedC: boolean[] = [];
    const bad = async () => {
      throw new Error("still offline");
    };
    const res2 = await recoverOrphanedRecordings({
      excludeRecordingId: "active-1",
      deps: {
        makeUploader: (id) => new ChunkUploader(id, { uploadFn: bad }),
        complete: async (_id, allUploaded) => {
          completedC.push(allUploaded);
        },
      },
    });
    const cRes = res2.find((r) => r.recordingId === "orphan-C");
    ok(
      !!cRes && cRes.remaining === 1 && cRes.recovered === 0,
      "orphan: an offline orphan stays queued (remaining=1) for the next load",
    );
    ok(
      completedC.includes(false),
      "orphan: an un-drained orphan is reported not-fully-uploaded",
    );
  }

  if (fails.length) {
    console.error(`\n✗ ${fails.length} assertion(s) failed.`);
    process.exit(1);
  }
  console.log("\n✓ Phase 13 unit verification PASSED.");
}

main().catch((e) => {
  console.error("PROBE ERROR:", e);
  process.exit(1);
});
