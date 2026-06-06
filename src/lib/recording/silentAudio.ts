/**
 * Recording Infrastructure — Layer 2: Silent keep-alive audio.
 *
 * Runs a zero-gain oscillator through an AudioContext for the life of a session.
 * An active audio graph keeps the browser from aggressively throttling a
 * backgrounded tab's timers and keeps the audio session warm, reducing the
 * chance the OS suspends the page when the app isn't foregrounded. Output is
 * silent (gain 0) so the rep hears nothing.
 *
 * Autoplay policy: the first start() must happen inside a user gesture (the
 * session's Start control provides it); a context created outside a gesture
 * stays "suspended" until a gesture resumes it. Feature-detected; no-op where
 * Web Audio is unavailable.
 */

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextCtor })
      .webkitAudioContext ??
    null
  );
}

export type SilentAudioStatus =
  | "idle"
  | "active"
  | "suspended"
  | "unsupported"
  | "error";

export function isSilentAudioSupported(): boolean {
  return getAudioContextCtor() !== null;
}

export class SilentAudioController {
  private ctx: AudioContext | null = null;
  private osc: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  private status: SilentAudioStatus = "idle";
  private readonly onChange?: (status: SilentAudioStatus) => void;

  constructor(onChange?: (status: SilentAudioStatus) => void) {
    this.onChange = onChange;
    if (!isSilentAudioSupported()) this.setStatus("unsupported");
  }

  getStatus(): SilentAudioStatus {
    return this.status;
  }

  private setStatus(status: SilentAudioStatus): void {
    this.status = status;
    this.onChange?.(status);
  }

  async start(): Promise<void> {
    const Ctor = getAudioContextCtor();
    if (!Ctor) {
      this.setStatus("unsupported");
      return;
    }
    try {
      if (!this.ctx) {
        const ctx = new Ctor();
        const gain = ctx.createGain();
        gain.gain.value = 0; // silent — the rep hears nothing
        const osc = ctx.createOscillator();
        osc.frequency.value = 440;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        this.ctx = ctx;
        this.gain = gain;
        this.osc = osc;
      }
      await this.ctx.resume();
      this.setStatus(this.ctx.state === "running" ? "active" : "suspended");
    } catch {
      this.setStatus("error");
    }
  }

  async stop(): Promise<void> {
    try {
      this.osc?.stop();
    } catch {
      // An oscillator that never started (or already stopped) throws — ignore.
    }
    try {
      this.osc?.disconnect();
      this.gain?.disconnect();
    } catch {
      // Nodes already torn down — ignore.
    }
    const ctx = this.ctx;
    this.osc = null;
    this.gain = null;
    this.ctx = null;
    if (ctx) {
      try {
        await ctx.close();
      } catch {
        // Context already closed — ignore.
      }
    }
    if (this.status !== "unsupported") this.setStatus("idle");
  }
}
