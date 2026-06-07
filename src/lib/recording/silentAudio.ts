/**
 * Recording Infrastructure — Layer 2: Silent keep-alive audio.
 *
 * Plays a looping, fully-silent <audio> element for the life of a session.
 *
 * Why a media element and not a Web Audio oscillator: iOS does NOT treat Web
 * Audio as media, so an oscillator (a) gets suspended the moment the screen
 * locks — exactly when a field rep's phone is recording — and (b) surfaces no
 * lock-screen Now-Playing widget for Layer 3 to attach Critiq's neutral branding
 * to. A real <audio> element that's actually playing keeps an OS audio session
 * warm in the background and gives Layer 3 the media element its presence needs
 * to exist. So this layer does double duty: sturdier locked-screen background
 * audio AND the anchor for the lock-screen branding.
 *
 * The element is appended to the document while live: iOS surfaces the
 * Now-Playing / lock-screen widget (and associates the MediaSession with it)
 * far more reliably for an in-document media element than a detached one. It has
 * no `controls`, so it renders nothing. start() attaches it; stop() removes it.
 *
 * The element is deliberately NOT muted — the silence lives in zero-PCM content,
 * not in muting. iOS treats a muted element as non-media and would surface no
 * lock-screen widget (defeating Layer 3). The rep still hears nothing.
 *
 * HONEST LIMIT: even with this, long screen-locked recording on iOS is
 * inherently constrained (see the capability chart — "60+ min mobile, screen
 * locked → ❌"), and iOS can suspend background output without dispatching a
 * `pause` event, so a stale "active" is possible. This maximizes the
 * best-effort and gets the branding; it is not a guarantee. Positioning stays:
 * desktop/foreground excellent, phone-locked best-effort. Active recovery
 * (re-play on resume, heartbeat) is a later recording phase.
 *
 * Autoplay policy: the first start() must happen inside a user gesture (the
 * session's Start control provides it); a play() the autoplay policy rejects
 * (NotAllowedError) reports "suspended" so the device check prompts another tap,
 * while any other failure reports the terminal "error". Feature-detected; a
 * graceful no-op where <audio> / Blob object URLs are unavailable.
 */

export type SilentAudioStatus =
  | "idle"
  | "active"
  | "suspended"
  | "unsupported"
  | "error";

export function isSilentAudioSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof Audio !== "undefined" &&
    typeof Blob !== "undefined" &&
    typeof URL !== "undefined" &&
    typeof URL.createObjectURL === "function"
  );
}

const SAMPLE_RATE = 8000;
const SILENCE_SECONDS = 1;

/**
 * Build a tiny, fully-silent mono 16-bit PCM WAV (44-byte header + zero samples)
 * and return it as an object URL. 16-bit PCM silence is literally zeroed bytes,
 * so the sample region — which a fresh ArrayBuffer already zero-fills — needs no
 * writing. The caller revokes the URL on stop().
 */
function createSilentWavUrl(): string {
  const bytesPerSample = 2; // 16-bit
  const numSamples = SAMPLE_RATE * SILENCE_SECONDS;
  const dataSize = numSamples * bytesPerSample; // mono
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string): void => {
    for (let i = 0; i < str.length; i += 1) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true); // RIFF chunk size
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // PCM fmt-chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, 1, true); // channels = mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * bytesPerSample, true); // byte rate (mono)
  view.setUint16(32, bytesPerSample, true); // block align (mono)
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, dataSize, true);
  // Sample region [44, 44 + dataSize) stays zero — that IS 16-bit silence.

  const blob = new Blob([buffer], { type: "audio/wav" });
  return URL.createObjectURL(blob);
}

export class SilentAudioController {
  private audio: HTMLAudioElement | null = null;
  private url: string | null = null;
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
    if (!isSilentAudioSupported()) {
      this.setStatus("unsupported");
      return;
    }
    try {
      if (!this.audio) {
        const url = createSilentWavUrl();
        const audio = new Audio();
        audio.src = url;
        audio.loop = true;
        audio.preload = "auto";
        // NOT muted: the silence is in the content. A muted element is non-media
        // to iOS and would surface no lock-screen widget (Layer 3's whole point).
        audio.addEventListener("playing", this.handlePlaying);
        audio.addEventListener("pause", this.handlePause);
        audio.addEventListener("error", this.handleError);
        // In-document so iOS reliably elects it as the session's media element
        // and surfaces the lock-screen widget. No controls → renders nothing.
        if (typeof document !== "undefined" && document.body) {
          document.body.appendChild(audio);
        }
        this.url = url;
        this.audio = audio;
      }
      const audio = this.audio;
      await audio.play();
      // stop() may have torn down the element during the await — guard.
      if (this.audio !== audio) return;
      // Only promote to "active" when truly playing. iOS can leave paused===true
      // for a beat after play() resolves; don't flash a false "suspended" — the
      // "playing" event is authoritative and will set "active" momentarily.
      if (!audio.paused) this.setStatus("active");
    } catch (err) {
      // stop() niled the element mid-await — nothing to report.
      if (!this.audio) return;
      // The autoplay policy rejecting play() outside a gesture is recoverable
      // with another tap ("suspended"); anything else (unsupported/decodable
      // source, etc.) is a terminal "error" so the check doesn't loop forever.
      const recoverable = err instanceof DOMException && err.name === "NotAllowedError";
      this.setStatus(recoverable ? "suspended" : "error");
    }
  }

  private handlePlaying = (): void => {
    if (this.audio) this.setStatus("active");
  };

  private handlePause = (): void => {
    if (!this.audio) return;
    // A failed load (e.g. the source rejected by CSP) fires `error` AND a trailing
    // `pause` — don't let that pause downgrade a terminal "error" to a recoverable
    // "suspended" (which would loop the device check forever). Only a clean pause
    // (OS interruption of a live element) is the recoverable case stop() guards by
    // detaching this handler before it pauses.
    this.setStatus(this.audio.error ? "error" : "suspended");
  };

  private handleError = (): void => {
    if (this.audio) this.setStatus("error");
  };

  async stop(): Promise<void> {
    const audio = this.audio;
    const url = this.url;
    this.audio = null;
    this.url = null;
    if (audio) {
      // Detach BEFORE pausing so our own pause() doesn't fire handlePause and
      // clobber the terminal "idle" with "suspended".
      audio.removeEventListener("playing", this.handlePlaying);
      audio.removeEventListener("pause", this.handlePause);
      audio.removeEventListener("error", this.handleError);
      try {
        audio.pause();
      } catch {
        // Element already torn down — ignore.
      }
      audio.remove(); // detach from the document (no-op if never attached)
    }
    if (url) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Already revoked — ignore.
      }
    }
    if (this.status !== "unsupported") this.setStatus("idle");
  }
}
