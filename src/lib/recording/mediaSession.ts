/**
 * Recording Infrastructure — Layer 3: Media Session presence (BRANDING ONLY).
 *
 * Populates the OS media-session metadata so any lock-screen / media-hub surface
 * that appears while a session is live shows neutral Critiq branding — never the
 * word "recording" or any hint of capture. This is a locked privacy decision in
 * the spec: nothing on a glanceable lock screen should reveal what the rep is
 * doing. It also registers inert transport handlers so the OS controls reflect
 * our app-controlled state instead of a stale default, and sets playbackState.
 * clear() resets everything. Feature-detected.
 */

export type MediaSessionStatus = "idle" | "active" | "unsupported";

export function isMediaSessionSupported(): boolean {
  return typeof navigator !== "undefined" && "mediaSession" in navigator;
}

// Branding only — deliberately NO "recording" / "call" / "capture" language.
const BRAND_METADATA: MediaMetadataInit = {
  title: "Critiq",
  artist: "Critiq",
  album: "Critiq",
};

// Transport actions we claim so the OS shows our state, not a default player's.
const HANDLED_ACTIONS: MediaSessionAction[] = ["play", "pause", "stop"];

export class MediaSessionController {
  private status: MediaSessionStatus = "idle";
  private readonly onChange?: (status: MediaSessionStatus) => void;

  constructor(onChange?: (status: MediaSessionStatus) => void) {
    this.onChange = onChange;
    if (!isMediaSessionSupported()) this.setStatus("unsupported");
  }

  getStatus(): MediaSessionStatus {
    return this.status;
  }

  private setStatus(status: MediaSessionStatus): void {
    this.status = status;
    this.onChange?.(status);
  }

  start(): void {
    if (!isMediaSessionSupported()) {
      this.setStatus("unsupported");
      return;
    }
    const ms = navigator.mediaSession;
    try {
      ms.metadata = new MediaMetadata(BRAND_METADATA);
      ms.playbackState = "playing";
      for (const action of HANDLED_ACTIONS) {
        try {
          // Inert: the session is app-controlled; we just want to own the slot
          // so the OS doesn't surface a stale third-party player's controls.
          ms.setActionHandler(action, () => {});
        } catch {
          // This browser doesn't support this action — ignore it.
        }
      }
      this.setStatus("active");
    } catch {
      // Presence is best-effort; never let it break a session.
      this.setStatus("active");
    }
  }

  clear(): void {
    if (!isMediaSessionSupported()) {
      this.setStatus("unsupported");
      return;
    }
    const ms = navigator.mediaSession;
    try {
      ms.metadata = null;
      ms.playbackState = "none";
      for (const action of HANDLED_ACTIONS) {
        try {
          ms.setActionHandler(action, null);
        } catch {
          // Ignore unsupported actions.
        }
      }
    } catch {
      // Ignore — clearing is best-effort.
    }
    this.setStatus("idle");
  }
}
