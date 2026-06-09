/**
 * Capture-coverage unit verification (Phase 14b). Drives the REAL
 * SegmentedRecorder with a fake clock + fake media and asserts the capture-gap
 * math: a large inter-chunk interval (iOS suspends the mic the moment a PWA is
 * backgrounded / the screen locks) is counted as lost audio; normal cadence and
 * sub-threshold jitter are not. Real on-device backgrounding stays the device
 * gate (Felix) — this pins the arithmetic the gate can't make repeatable.
 *
 * Run: pnpm tsx scripts/verify-coverage.ts
 */
import {
  SegmentedRecorder,
  type RecorderEngine,
  type RecorderTimers,
  type SegmentRecorderHandle,
  type SegmentRecorderOptions,
  type MicStream,
  type TimerHandle,
} from "../src/lib/recording/segmentedRecorder";

const fails: string[] = [];
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) fails.push(msg);
};

/** Advanceable clock. The probe keeps heartbeat/rotation/hard-cap timers far out
 *  of range, so advance() only needs to move `now` — no timer fires in-window. */
class FakeTimers implements RecorderTimers {
  // Non-zero base: the real clock is Date.now(); sessionStartMs must be truthy
  // for getState().elapsedMs to compute (it guards `sessionStartMs ? … : 0`).
  private t = 1_000_000;
  private seq = 1;
  private timeouts: { id: number; at: number; fn: () => void }[] = [];
  private intervals: { id: number; every: number; fn: () => void }[] = [];
  now() {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number): TimerHandle {
    const id = this.seq++;
    this.timeouts.push({ id, at: this.t + ms, fn });
    return id;
  }
  clearTimeout(h: TimerHandle) {
    this.timeouts = this.timeouts.filter((x) => x.id !== h);
  }
  setInterval(fn: () => void, ms: number): TimerHandle {
    const id = this.seq++;
    this.intervals.push({ id, every: ms, fn });
    return id;
  }
  clearInterval(h: TimerHandle) {
    this.intervals = this.intervals.filter((x) => x.id !== h);
  }
  advance(ms: number) {
    this.t += ms;
  }
}

class FakeRec implements SegmentRecorderHandle {
  state: "recording" | "paused" | "inactive" = "inactive";
  constructor(private readonly opts: SegmentRecorderOptions) {}
  start() {
    this.state = "recording";
  }
  async stop() {
    this.state = "inactive";
  }
  getState() {
    return this.state;
  }
  emit() {
    this.opts.onChunk(new Blob([new Uint8Array(16)], { type: "audio/webm" }), "audio/webm");
  }
}

function makeEngine() {
  const recorders: FakeRec[] = [];
  const engine: RecorderEngine = {
    isSupported: () => true,
    pickMimeType: () => "audio/webm",
    async acquireStream(): Promise<MicStream> {
      return { isLive: () => true, stop: () => {} };
    },
    createSegmentRecorder(_s, opts) {
      const r = new FakeRec(opts);
      recorders.push(r);
      return r;
    },
  };
  return { engine, current: () => recorders[recorders.length - 1] };
}

async function main() {
  const timers = new FakeTimers();
  const fe = makeEngine();
  // Keep rotation / heartbeat / hard-cap out of range; isolate the gap math.
  const rec = new SegmentedRecorder(
    { onChunk: () => {} },
    {
      engine: fe.engine,
      timers,
      config: {
        segmentMs: 1_000_000,
        overlapMs: 200,
        hardCapMs: 1_000_000,
        timesliceMs: 5000,
        heartbeatMs: 1_000_000,
        stallMs: 1_000_000,
        gapThresholdMs: 10_000,
      },
    },
  );
  await rec.start();

  fe.current().emit(); // chunk @ t=0
  ok(rec.getState().gapMs === 0 && rec.getState().gapCount === 0, "first chunk → no gap");

  timers.advance(5000);
  fe.current().emit(); // normal 5s cadence
  ok(rec.getState().gapCount === 0, "5s cadence is not a gap");

  timers.advance(8000);
  fe.current().emit(); // 8s < 10s threshold
  ok(rec.getState().gapCount === 0, "8s (< threshold) is not a gap");

  timers.advance(30000);
  fe.current().emit(); // 30s stall (backgrounded) → lost = 30000 - 5000
  ok(
    rec.getState().gapCount === 1 && rec.getState().gapMs === 25000,
    "30s stall → 1 gap, 25s lost",
  );

  timers.advance(49000);
  fe.current().emit(); // a 2nd stall → lost = 49000 - 5000
  ok(
    rec.getState().gapCount === 2 && rec.getState().gapMs === 25000 + 44000,
    "2nd stall accumulates → gapMs = 69s",
  );

  const st = rec.getState();
  const coverage = st.elapsedMs > 0 ? (st.elapsedMs - st.gapMs) / st.elapsedMs : 1;
  ok(coverage > 0 && coverage < 1, "coverage derives to a fraction < 1 when gaps exist");

  await rec.stop();

  await rec.start();
  ok(
    rec.getState().gapMs === 0 && rec.getState().gapCount === 0,
    "start() resets the gap counters for a fresh session",
  );
  await rec.stop();

  if (fails.length) {
    console.error(`\n✗ ${fails.length} assertion(s) failed.`);
    process.exit(1);
  }
  console.log("\n✓ Coverage unit verification PASSED.");
}

main().catch((e) => {
  console.error("PROBE ERROR:", e);
  process.exit(1);
});
