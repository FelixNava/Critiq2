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
        const fresh = new Ctor();
        const gain = fresh.createGain();
        gain.gain.value = 0; // silent — the rep hears nothing
        const osc = fresh.createOscillator();
        osc.frequency.value = 440;
        osc.connect(gain);
        gain.connect(fresh.destination);
        osc.start();
        // Reflect OS-driven suspend/resume of a backgrounded tab so the status
        // doesn't go stale. (Active recovery — re-resume, heartbeat — is a later
        // recording phase; here we just report the truth honestly.)
        fresh.onstatechange = this.handleStateChange;
        this.ctx = fresh;
        this.gain = gain;
        this.osc = osc;
      }
      const ctx = this.ctx;
      await ctx.resume();
      // stop() may have closed/cleared the context during the await — guard.
      if (this.ctx !== ctx) return;
      this.setStatus(ctx.state === "running" ? "active" : "suspended");
    } catch {
      this.setStatus("error");
    }
  }

  private handleStateChange = (): void => {
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state === "running") this.setStatus("active");
    else if (ctx.state === "suspended") this.setStatus("suspended");
    // "closed" is driven by stop(), which sets the terminal status itself.
  };

  async stop(): Promise<void> {
    if (this.ctx) this.ctx.onstatechange = null;
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
