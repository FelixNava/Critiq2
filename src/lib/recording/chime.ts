/**
 * Audible interruption chime (Phase 14, channel a). A short two-tone alert via
 * the Web Audio API — no asset to load, and the AudioContext is created/resumed
 * lazily so it inherits the user-gesture unlock from the Start button (iOS
 * requires audio to start from a gesture; by record time we already have one).
 *
 * A chime carries no text, so the lock-screen/branding-only privacy rule is moot
 * here. raise() plays once per interruption edge; clear() is a no-op (it's a
 * one-shot alert, not a sustained sound).
 */
import type { NotificationChannel } from "./interruption";

type AudioCtor = typeof AudioContext;

function audioCtor(): AudioCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    AudioContext?: AudioCtor;
    webkitAudioContext?: AudioCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export function isChimeSupported(): boolean {
  return audioCtor() !== null;
}

export function createChimeChannel(): NotificationChannel {
  let ctx: AudioContext | null = null;

  const ensureCtx = (): AudioContext | null => {
    const Ctor = audioCtor();
    if (!Ctor) return null;
    if (!ctx) ctx = new Ctor();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  };

  const beep = (ac: AudioContext, startAt: number, freq: number): void => {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    // Quick attack/decay so it reads as an alert, not a drone.
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.25, startAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.22);
    osc.connect(gain).connect(ac.destination);
    osc.start(startAt);
    osc.stop(startAt + 0.24);
  };

  return {
    raise() {
      const ac = ensureCtx();
      if (!ac) return;
      const t = ac.currentTime;
      // Two descending tones — a recognizable "attention" cadence.
      beep(ac, t + 0.0, 880);
      beep(ac, t + 0.26, 660);
    },
    clear() {
      // One-shot; nothing to stop.
    },
  };
}
