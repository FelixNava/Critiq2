/**
 * Audible interruption chime (Phase 14, channel a). A short two-tone alert via
 * the Web Audio API — no asset to load.
 *
 * iOS unlock + leak avoidance: the AudioContext is a MODULE SINGLETON created the
 * first time a channel is built. createChimeChannel() runs inside the recorder's
 * Start handler (a real user gesture), so creating + resuming the context there
 * unlocks it on iOS/autoplay-restricted browsers (a context first touched at
 * interruption time — outside any gesture — would stay suspended and never
 * sound). One context for the page lifetime also means repeated record sessions
 * don't leak a new context each time.
 *
 * Honest limit (device gate): on a LOCKED iPhone screen iOS suspends Web Audio,
 * so the chime won't sound there — that lock-screen case is what Web Push covers.
 * The chime is for the screen-on, tabbed/app-switched-away case.
 *
 * A chime carries no text, so the branding-only privacy rule is moot here.
 * raise() plays once per interruption edge; clear() is a no-op (one-shot alert).
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

// One context for the whole page — created/resumed within the Start gesture.
let sharedCtx: AudioContext | null = null;

function ensureCtx(): AudioContext | null {
  const Ctor = audioCtor();
  if (!Ctor) return null;
  if (!sharedCtx) {
    try {
      sharedCtx = new Ctor();
    } catch {
      return null;
    }
  }
  // resume() is a no-op if already running; needed if the browser auto-suspended.
  if (sharedCtx.state === "suspended") void sharedCtx.resume();
  return sharedCtx;
}

export function createChimeChannel(): NotificationChannel {
  // Eagerly unlock the context now — we're inside the Start gesture.
  ensureCtx();

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
      // One-shot; nothing to stop. The context is intentionally kept alive for
      // the next interruption (and the next session).
    },
  };
}
