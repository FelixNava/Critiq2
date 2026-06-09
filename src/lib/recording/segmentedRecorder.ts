/**
 * Recording Infrastructure — Phase 13: auto-segmentation + heartbeat + tiered
 * recovery. Builds on the Layer-4 capture primitives (recorder.ts) and feeds the
 * same RecorderChunk stream the uploader (Layer 5) + chunkStore (Layer 6) consume.
 *
 * Reliability model (locked in /critiq-context "Recording Reliability Stack"):
 *  - ONE mic stream is acquired once and SHARED across rotating MediaRecorders.
 *  - Segments rotate every ~10 min. A new segment's recorder starts OVERLAP_MS
 *    (2s) BEFORE the previous one stops, so both capture the seam → zero audio
 *    gap (the 2s overlap is intentional redundancy a later transcription phase
 *    trims). Each chunk is tagged with the segment it belongs to.
 *  - A 5s heartbeat checks the stream + recorder + chunk flow. On a fault it
 *    escalates recovery: Tier 1 restart the MediaRecorder, Tier 2 re-acquire the
 *    stream, Tier 3 re-prompt the mic, Tier 4 notify (auto-recovery exhausted —
 *    the chime/banner/Web-Push UX is Phase 14; this layer fires the hook + sets
 *    the state). Escalation is heartbeat-driven: a recovery action is judged by
 *    the NEXT heartbeat — if health returns, the tier resets; if not, it escalates.
 *  - Hard cap at 75 min.
 *
 * Everything time/media is injectable (RecorderTimers + RecorderEngine) so the
 * rotation, heartbeat, and recovery state machine is unit-tested deterministically
 * with a fake clock + fake media (scripts/verify-phase13.ts) — no browser, no mic.
 */

import {
  DEFAULT_TIMESLICE_MS,
  isRecordingSupported,
  pickMimeType,
  type RecorderChunk,
} from "./recorder";

// ---- tunables (the locked reliability parameters) ----
export const SEGMENT_MS = 10 * 60 * 1000; // 10-min segment rotation
export const OVERLAP_MS = 2000; // 2s cutover overlap → zero audio gap
export const HARD_CAP_MS = 75 * 60 * 1000; // hard stop at 75 min
export const HEARTBEAT_MS = 5000; // health check cadence
// No chunk for this long while "recording" ⇒ the recorder is wedged. 3× the 5s
// timeslice tolerates one missed/late chunk before we treat it as a stall.
export const STALL_MS = 15000;
export const MAX_RECOVERY_TIER = 4;

export interface SegmentedRecorderConfig {
  segmentMs: number;
  overlapMs: number;
  hardCapMs: number;
  timesliceMs: number;
  heartbeatMs: number;
  stallMs: number;
}

export const DEFAULT_CONFIG: SegmentedRecorderConfig = {
  segmentMs: SEGMENT_MS,
  overlapMs: OVERLAP_MS,
  hardCapMs: HARD_CAP_MS,
  timesliceMs: DEFAULT_TIMESLICE_MS,
  heartbeatMs: HEARTBEAT_MS,
  stallMs: STALL_MS,
};

export type SegmentedStatus =
  | "idle"
  | "requesting" // awaiting the getUserMedia permission prompt
  | "recording"
  | "recovering"
  | "stopped"
  | "unsupported"
  | "error";

export type RecoveryTier = 0 | 1 | 2 | 3 | 4;

export type AutoStopReason = "hard-cap" | "fatal";

export interface HeartbeatState {
  healthy: boolean;
  /** ms since the last chunk arrived, or null if none yet this segment. */
  lastChunkAgeMs: number | null;
  recorderState: string;
  trackLive: boolean;
}

export interface RecoveryEvent {
  tier: RecoveryTier;
  /** Human-readable action label for the lab log (no dev jargon needed here). */
  action: string;
  ok: boolean;
  at: number;
}

export interface SegmentedRecorderState {
  status: SegmentedStatus;
  /** Current (newest) segment index, 0-based. */
  segmentIndex: number;
  /** Total segments started this session. */
  segmentCount: number;
  recoveryTier: RecoveryTier;
  heartbeat: HeartbeatState | null;
  elapsedMs: number;
}

// ---- injectable time ----
export type TimerHandle = number;

export interface RecorderTimers {
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(h: TimerHandle): void;
  setInterval(fn: () => void, ms: number): TimerHandle;
  clearInterval(h: TimerHandle): void;
}

const browserTimers: RecorderTimers = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (h) => window.clearTimeout(h),
  setInterval: (fn, ms) => window.setInterval(fn, ms),
  clearInterval: (h) => window.clearInterval(h),
};

// ---- injectable media ----
export interface MicStream {
  /** True while at least one audio track is live (not ended/muted-stopped). */
  isLive(): boolean;
  /** Stop every track (releases the mic). */
  stop(): void;
  /**
   * Optional: register a callback fired the instant an audio track ends — the
   * mic was revoked or grabbed by another app. Phase 14 uses this for IMMEDIATE
   * interruption detection (faster than the ≤5s heartbeat). Optional so injected
   * fakes need not implement it; the heartbeat remains the reliable fallback.
   */
  onEnded?(cb: () => void): void;
}

export interface SegmentRecorderHandle {
  start(): void;
  stop(): Promise<void>;
  getState(): "recording" | "paused" | "inactive";
}

export interface SegmentRecorderOptions {
  timesliceMs: number;
  mimeType: string;
  onChunk: (blob: Blob, mimeType: string) => void;
  onError: (err: unknown) => void;
}

export interface RecorderEngine {
  isSupported(): boolean;
  pickMimeType(): string;
  acquireStream(): Promise<MicStream>;
  createSegmentRecorder(
    stream: MicStream,
    opts: SegmentRecorderOptions,
  ): SegmentRecorderHandle;
}

/** Browser MicStream over a real MediaStream. */
class BrowserMicStream implements MicStream {
  constructor(readonly raw: MediaStream) {}
  isLive(): boolean {
    const tracks = this.raw.getAudioTracks();
    return tracks.length > 0 && tracks.some((t) => t.readyState === "live");
  }
  onEnded(cb: () => void): void {
    for (const t of this.raw.getAudioTracks()) {
      t.addEventListener("ended", cb, { once: true });
    }
  }
  stop(): void {
    for (const t of this.raw.getTracks()) {
      try {
        t.stop();
      } catch {
        // ignore
      }
    }
  }
}

/** Default engine: real getUserMedia + a MediaRecorder per segment. */
export const browserEngine: RecorderEngine = {
  isSupported: isRecordingSupported,
  pickMimeType,
  async acquireStream(): Promise<MicStream> {
    const raw = await navigator.mediaDevices.getUserMedia({ audio: true });
    return new BrowserMicStream(raw);
  },
  createSegmentRecorder(stream, opts): SegmentRecorderHandle {
    const raw = (stream as BrowserMicStream).raw;
    let rec: MediaRecorder;
    try {
      rec = opts.mimeType
        ? new MediaRecorder(raw, { mimeType: opts.mimeType })
        : new MediaRecorder(raw);
    } catch {
      rec = new MediaRecorder(raw);
    }
    rec.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) {
        opts.onChunk(
          e.data,
          rec.mimeType || opts.mimeType || e.data.type || "application/octet-stream",
        );
      }
    };
    rec.onerror = (e: Event) =>
      opts.onError((e as unknown as { error?: unknown }).error ?? e);

    return {
      start: () => {
        try {
          rec.start(opts.timesliceMs);
        } catch (err) {
          opts.onError(err);
        }
      },
      stop: () =>
        new Promise<void>((resolve) => {
          if (rec.state === "inactive") return resolve();
          let settled = false;
          const done = () => {
            if (settled) return;
            settled = true;
            resolve();
          };
          rec.addEventListener("stop", done, { once: true });
          // Guard a missing "stop" event (rare engine quirk) from wedging us.
          window.setTimeout(done, 2000);
          try {
            rec.stop();
          } catch {
            done();
          }
        }),
      getState: () => rec.state,
    };
  },
};

export interface SegmentedRecorderCallbacks {
  onChunk: (chunk: RecorderChunk) => void;
  onState?: (state: SegmentedRecorderState) => void;
  onError?: (err: unknown) => void;
  onRecovery?: (event: RecoveryEvent) => void;
  /** Fired when the recorder stops itself (hard cap or unrecoverable fault) so
   *  the caller runs the same finalize (flush + complete) it runs on a user stop. */
  onAutoStop?: (reason: AutoStopReason) => void;
  /** Fired the instant a mic track ends (audio session grabbed / mic revoked) —
   *  Phase 14 turns this into the immediate interruption notification. Redundant
   *  with the heartbeat's trackLive=false detection, just faster. */
  onTrackEnded?: () => void;
}

/**
 * Manages the lifetime of a multi-segment recording: rotation with overlap, the
 * heartbeat, and tiered recovery. The caller (useRecorder) owns the keep-alive +
 * the upload of the chunks this emits.
 */
export class SegmentedRecorder {
  private readonly callbacks: SegmentedRecorderCallbacks;
  private readonly engine: RecorderEngine;
  private readonly timers: RecorderTimers;
  private readonly config: SegmentedRecorderConfig;

  private status: SegmentedStatus = "idle";
  private stream: MicStream | null = null;
  private mimeType = "";
  private current: SegmentRecorderHandle | null = null;
  private previous: SegmentRecorderHandle | null = null; // during the overlap

  private sessionStartMs = 0;
  private segmentStartMs = 0;
  private lastChunkAtMs: number | null = null;
  private globalChunkIndex = 0;
  private segmentIndex = 0;
  private segmentCount = 0;

  private rotationTimer: TimerHandle | null = null;
  private overlapStopTimer: TimerHandle | null = null;
  private hardCapTimer: TimerHandle | null = null;
  private heartbeatTimer: TimerHandle | null = null;

  private recovering = false;
  private recoveryInFlight = false; // a recovery action is mid-await
  private recoveryTier: RecoveryTier = 0;
  private heartbeat: HeartbeatState | null = null;
  private stopped = false;

  constructor(
    callbacks: SegmentedRecorderCallbacks,
    opts?: {
      engine?: RecorderEngine;
      timers?: RecorderTimers;
      config?: Partial<SegmentedRecorderConfig>;
    },
  ) {
    this.callbacks = callbacks;
    this.engine = opts?.engine ?? browserEngine;
    this.timers = opts?.timers ?? browserTimers;
    this.config = { ...DEFAULT_CONFIG, ...opts?.config };
    if (!this.engine.isSupported()) this.setStatus("unsupported");
  }

  getStatus(): SegmentedStatus {
    return this.status;
  }

  getState(): SegmentedRecorderState {
    return {
      status: this.status,
      segmentIndex: this.segmentIndex,
      segmentCount: this.segmentCount,
      recoveryTier: this.recoveryTier,
      heartbeat: this.heartbeat ? { ...this.heartbeat } : null,
      elapsedMs: this.sessionStartMs ? this.timers.now() - this.sessionStartMs : 0,
    };
  }

  private setStatus(status: SegmentedStatus): void {
    this.status = status;
    this.notify();
  }

  private notify(): void {
    this.callbacks.onState?.(this.getState());
  }

  async start(): Promise<void> {
    if (!this.engine.isSupported()) {
      this.setStatus("unsupported");
      return;
    }
    if (this.stream || this.current) return; // already running

    this.setStatus("requesting");
    try {
      this.stream = await this.engine.acquireStream();
    } catch (err) {
      this.setStatus("error");
      this.callbacks.onError?.(err);
      return;
    }
    this.wireTrackEnded();

    this.mimeType = this.engine.pickMimeType();
    this.sessionStartMs = this.timers.now();
    this.segmentStartMs = this.sessionStartMs;
    this.segmentIndex = 0;
    this.segmentCount = 1;
    this.globalChunkIndex = 0;
    this.lastChunkAtMs = null;
    this.stopped = false;

    this.current = this.makeSegmentRecorder(this.segmentIndex);
    this.current.start();

    this.hardCapTimer = this.timers.setTimeout(
      () => void this.autoStop("hard-cap"),
      this.config.hardCapMs,
    );
    this.scheduleRotation();
    this.startHeartbeat();
    this.setStatus("recording");
  }

  /** Wire the current stream's track-ended signal to the Phase 14 callback. The
   *  fault still flows through the heartbeat too (trackLive=false → recovery);
   *  this just gives the notification layer an immediate edge. Best-effort: a
   *  stream without onEnded (injected fakes) simply relies on the heartbeat. */
  private wireTrackEnded(): void {
    this.stream?.onEnded?.(() => {
      if (!this.stopped) this.callbacks.onTrackEnded?.();
    });
  }

  /** Create a segment recorder whose chunks are tagged with THIS segment index
   *  (so overlap chunks from the outgoing recorder keep the old segment index). */
  private makeSegmentRecorder(segmentIndex: number): SegmentRecorderHandle {
    return this.engine.createSegmentRecorder(this.stream as MicStream, {
      timesliceMs: this.config.timesliceMs,
      mimeType: this.mimeType,
      onChunk: (blob, mimeType) => this.emitChunk(segmentIndex, blob, mimeType),
      onError: (err) => this.callbacks.onError?.(err),
    });
  }

  private emitChunk(segmentIndex: number, blob: Blob, mimeType: string): void {
    this.lastChunkAtMs = this.timers.now();
    this.callbacks.onChunk({
      index: this.globalChunkIndex++,
      segmentIndex,
      blob,
      mimeType,
    });
  }

  // ---- rotation ----
  private scheduleRotation(): void {
    if (this.rotationTimer !== null) this.timers.clearTimeout(this.rotationTimer);
    // Start the next segment OVERLAP_MS before the current one's nominal end.
    const delay = Math.max(0, this.config.segmentMs - this.config.overlapMs);
    this.rotationTimer = this.timers.setTimeout(() => this.rotate(), delay);
  }

  private rotate(): void {
    if (this.stopped) return;
    // Don't rotate onto a stream we're mid-recovering — try again shortly.
    if (this.recovering) {
      this.rotationTimer = this.timers.setTimeout(
        () => this.rotate(),
        this.config.heartbeatMs,
      );
      return;
    }

    // Begin the overlap: the new segment starts while the old one keeps running.
    this.previous = this.current;
    this.segmentIndex += 1;
    this.segmentCount += 1;
    this.segmentStartMs = this.timers.now();
    this.current = this.makeSegmentRecorder(this.segmentIndex);
    this.current.start();

    const outgoing = this.previous;
    this.overlapStopTimer = this.timers.setTimeout(() => {
      this.previous = null;
      void outgoing?.stop();
    }, this.config.overlapMs);

    this.scheduleRotation();
    this.notify();
  }

  // ---- heartbeat ----
  private startHeartbeat(): void {
    if (this.heartbeatTimer !== null)
      this.timers.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = this.timers.setInterval(
      () => this.checkHealth(),
      this.config.heartbeatMs,
    );
  }

  private checkHealth(): void {
    if (this.stopped) return;
    const now = this.timers.now();
    const trackLive = this.stream?.isLive() ?? false;
    const recorderState = this.current?.getState() ?? "inactive";
    // Stall is measured from the last chunk, or the segment start if none yet
    // (so a recorder that never emits is still caught after stallMs).
    const sinceChunk = now - (this.lastChunkAtMs ?? this.segmentStartMs);
    const stalled = sinceChunk > this.config.stallMs;
    const healthy = trackLive && recorderState === "recording" && !stalled;

    this.heartbeat = {
      healthy,
      lastChunkAgeMs: this.lastChunkAtMs === null ? null : now - this.lastChunkAtMs,
      recorderState,
      trackLive,
    };

    if (healthy) {
      if (this.recovering) {
        // The last recovery action restored health.
        this.recovering = false;
        this.recoveryTier = 0;
        this.callbacks.onRecovery?.({
          tier: 0,
          action: "Recovered — capture resumed",
          ok: true,
          at: now,
        });
        this.setStatus("recording");
        return;
      }
    } else if (!this.recovering) {
      void this.beginRecovery(this.diagnose(trackLive), now);
    } else if (!this.recoveryInFlight) {
      // Only escalate once the prior recovery action has settled — a slow
      // acquireStream must not let successive beats launch overlapping recoveries
      // that race on this.stream / this.current.
      void this.escalateRecovery(now);
    }
    this.notify();
  }

  // ---- recovery ----
  private diagnose(trackLive: boolean): RecoveryTier {
    // A dead/ended track needs a fresh stream (Tier 2). A live track with a dead
    // OR wedged recorder just needs the recorder restarted on the same stream
    // (Tier 1) — both recorder faults share the same first remedy.
    return trackLive ? 1 : 2;
  }

  private async beginRecovery(tier: RecoveryTier, at: number): Promise<void> {
    this.recovering = true;
    this.recoveryTier = tier;
    this.setStatus("recovering");
    await this.performRecovery(tier, at);
  }

  private async escalateRecovery(at: number): Promise<void> {
    if (this.recoveryTier >= MAX_RECOVERY_TIER) {
      // Already notified (Tier 4). Leave the heartbeat running so a manual fix
      // (e.g. the user re-grants the mic) still recovers on a later beat.
      return;
    }
    const next = (this.recoveryTier + 1) as RecoveryTier;
    this.recoveryTier = next;
    await this.performRecovery(next, at);
    this.notify();
  }

  /**
   * Give a freshly-(re)started recorder a full stall window to emit its first
   * chunk before the heartbeat judges it. Without this, the beat right after a
   * restart still sees the OLD chunk age and falsely escalates a recovery that
   * actually worked.
   */
  private resetStallClock(): void {
    this.lastChunkAtMs = null;
    this.segmentStartMs = this.timers.now();
  }

  private async performRecovery(tier: RecoveryTier, at: number): Promise<void> {
    this.recoveryInFlight = true;
    try {
      if (this.stopped) return;
      if (tier === 1) {
        // Tier 1 — restart the MediaRecorder on the SAME stream.
        await this.current?.stop();
        if (this.stopped) return;
        this.resetStallClock();
        this.current = this.makeSegmentRecorder(this.segmentIndex);
        this.current.start();
        this.report(tier, "Restarting the recorder", true, at);
      } else if (tier === 2 || tier === 3) {
        // Tier 2 — re-acquire the stream. Tier 3 — re-prompt the mic (same
        // getUserMedia call; it re-prompts if permission was revoked).
        let nextStream: MicStream;
        try {
          nextStream = await this.engine.acquireStream();
        } catch (err) {
          // Re-acquire denied/failed — the next beat escalates a tier.
          this.report(tier, "Recovery attempt failed", false, at);
          this.callbacks.onError?.(err);
          return;
        }
        // The session may have been stopped while we awaited the prompt — never
        // leave a freshly-opened mic running past stop().
        if (this.stopped) {
          nextStream.stop();
          return;
        }
        this.stream?.stop();
        await this.current?.stop();
        if (this.stopped) {
          nextStream.stop();
          return;
        }
        this.stream = nextStream;
        this.wireTrackEnded();
        this.resetStallClock();
        this.current = this.makeSegmentRecorder(this.segmentIndex);
        this.current.start();
        this.report(
          tier,
          tier === 2
            ? "Reconnecting the microphone"
            : "Asking for the microphone again",
          true,
          at,
        );
      } else {
        // Tier 4 — auto-recovery exhausted. Notify, then save what we have and
        // stop (release the keep-alive + close the session row) rather than leak
        // resources on a session that can't continue. The chime/banner/Web-Push
        // notification UX is Phase 14.
        this.report(tier, "Couldn't recover — saved and stopped", false, at);
        this.setStatus("error");
        await this.autoStop("fatal");
      }
    } finally {
      this.recoveryInFlight = false;
    }
  }

  private report(tier: RecoveryTier, action: string, ok: boolean, at: number): void {
    this.callbacks.onRecovery?.({ tier, action, ok, at });
  }

  // ---- stop ----
  private clearTimers(): void {
    if (this.rotationTimer !== null) {
      this.timers.clearTimeout(this.rotationTimer);
      this.rotationTimer = null;
    }
    if (this.overlapStopTimer !== null) {
      this.timers.clearTimeout(this.overlapStopTimer);
      this.overlapStopTimer = null;
    }
    if (this.hardCapTimer !== null) {
      this.timers.clearTimeout(this.hardCapTimer);
      this.hardCapTimer = null;
    }
    if (this.heartbeatTimer !== null) {
      this.timers.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async autoStop(reason: AutoStopReason): Promise<void> {
    if (this.stopped) return;
    // Await teardown so the stopping recorder's final flushed chunk is emitted
    // (its onChunk runs during stop()) BEFORE the caller finalizes the count.
    await this.teardown();
    this.callbacks.onAutoStop?.(reason);
  }

  private async teardown(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.clearTimers();
    const a = this.current;
    const b = this.previous;
    this.current = null;
    this.previous = null;
    await Promise.allSettled([a?.stop(), b?.stop()]);
    this.stream?.stop();
    this.stream = null;
    // Preserve a terminal 'error' (Tier-4 exhaustion) — don't downgrade it to a
    // clean 'stopped'.
    if (this.status !== "unsupported" && this.status !== "error") {
      this.setStatus("stopped");
    }
  }

  /** Stop everything and release the mic. Idempotent. */
  async stop(): Promise<void> {
    await this.teardown();
  }
}
