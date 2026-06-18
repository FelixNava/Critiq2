/**
 * Recording Infrastructure — Phase 14: interruption detection + multi-channel
 * notification.
 *
 * This is the framework-free, fully-injectable CORE. It turns Phase 13's
 * SegmentedRecorder signals (status `recovering`/`error`, the 5s heartbeat's
 * `trackLive`, the recovery tier) PLUS an immediate `track.onended` signal into a
 * single "capture interrupted" boolean, and drives four notification channels
 * (chime, tab-title flash, Web Push, in-app banner) when it flips.
 *
 * The detection is a pure predicate (deriveInterrupted) and the orchestration is
 * a small state machine (InterruptionMonitor) — both unit-tested with FAKE
 * channels + a synthetic signal sequence (scripts/verify-phase14.ts), no browser.
 * The browser-side channel implementations live in chime.ts / tabTitle.ts /
 * pushClient.ts; the hook wires them in.
 *
 * PRIVACY: the channels that render on a lock screen / notification surface
 * (Web Push, tab title) carry ONLY Critiq branding — never "recording", never
 * call content. That contract is enforced in those channel modules + the SW; the
 * monitor here only decides WHEN to alert, not WHAT text shows.
 */

import type {
  SegmentedStatus,
  HeartbeatState,
  RecoveryTier,
} from "./segmentedRecorder";

/** The slice of recorder state the interruption logic reads. */
export interface InterruptionSignal {
  status: SegmentedStatus;
  heartbeat: HeartbeatState | null;
  recoveryTier: RecoveryTier;
}

/** A single notification channel. raise() begins alerting, clear() stops. */
export interface NotificationChannel {
  raise(): void;
  clear(): void;
}

export interface InterruptionChannels {
  chime: NotificationChannel;
  tabTitle: NotificationChannel;
  push: NotificationChannel;
  banner: NotificationChannel;
}

/**
 * Pure predicate: is the recorder in a user-meaningful interruption RIGHT NOW?
 *
 * True when capture has fatally failed (`error`), or when we're recovering
 * specifically because the mic/audio session was lost (`recovering` with a dead
 * track — e.g. another app grabbed the microphone). A transient recorder
 * hiccup where the track is still live (Tier-1 restart) is NOT surfaced as an
 * interruption: it auto-restarts within a beat and alarming the rep over it
 * would cry wolf. The existing health UI still shows those.
 */
export function deriveInterrupted(s: InterruptionSignal): boolean {
  if (s.status === "error") return true;
  if (s.status === "recovering" && s.heartbeat?.trackLive === false) return true;
  return false;
}

function isTerminal(status: SegmentedStatus): boolean {
  return status === "stopped" || status === "idle" || status === "unsupported";
}

function isHealthyRecording(s: InterruptionSignal): boolean {
  return (
    s.status === "recording" &&
    s.recoveryTier === 0 &&
    (s.heartbeat?.healthy ?? false)
  );
}

/**
 * Orchestrates the four channels off the interruption boolean. Idempotent: each
 * channel is raised once on the false→true edge and cleared once on true→false;
 * repeated signals in the same state do nothing.
 */
export class InterruptionMonitor {
  private active = false;
  // Set the instant track.onended fires (faster than the ≤5s heartbeat). The
  // heartbeat path and this path are intentionally redundant; the latch holds
  // the alert raised until a genuinely-healthy recording beat (or a clean stop)
  // confirms capture is back, so an immediate alert can't be dropped by a stale
  // pre-heartbeat state update.
  private trackEnded = false;
  // The monitor only alerts once capture has actually started (seen a
  // `recording` status). This stops an INITIAL failure — a denied mic permission
  // goes requesting→error without ever recording — from chiming/flashing as if a
  // live call had been interrupted. There's nothing to interrupt yet.
  private armed = false;

  constructor(
    private readonly channels: InterruptionChannels,
    private readonly opts: { onChange?: (active: boolean) => void } = {},
  ) {}

  isActive(): boolean {
    return this.active;
  }

  /** Immediate interruption signal from a mic track ending. */
  signalTrackEnded(): void {
    if (!this.armed) return;
    this.trackEnded = true;
    this.setActive(true);
  }

  /** Fed on every recorder state update. */
  update(signal: InterruptionSignal): void {
    if (signal.status === "recording") this.armed = true;
    if (isTerminal(signal.status) || isHealthyRecording(signal)) {
      this.trackEnded = false;
    }
    const interrupted =
      this.armed &&
      !isTerminal(signal.status) &&
      (deriveInterrupted(signal) || this.trackEnded);
    this.setActive(interrupted);
  }

  /** Force-clear everything (call on a user stop / teardown). */
  reset(): void {
    this.trackEnded = false;
    this.armed = false;
    this.setActive(false);
  }

  private setActive(next: boolean): void {
    if (next === this.active) return;
    this.active = next;
    const list = [
      this.channels.chime,
      this.channels.tabTitle,
      this.channels.push,
      this.channels.banner,
    ];
    for (const ch of list) {
      try {
        if (next) ch.raise();
        else ch.clear();
      } catch {
        // A channel failing (e.g. AudioContext blocked) must not take the others
        // down or wedge the state machine.
      }
    }
    this.opts.onChange?.(next);
  }
}
