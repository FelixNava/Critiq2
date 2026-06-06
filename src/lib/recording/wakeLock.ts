/**
 * Recording Infrastructure — Layer 1: Screen Wake Lock.
 *
 * Holds a screen wake lock so the display doesn't sleep during a live session
 * (a sleeping screen on mobile suspends the page and kills capture). The browser
 * auto-releases the lock whenever the tab is hidden, so this controller re-
 * acquires it on `visibilitychange` for as long as it's meant to be active.
 * Feature-detected and a graceful no-op where unsupported (e.g. older iOS,
 * Firefox desktop).
 *
 * No audio capture lives here — this only keeps the screen awake around it. The
 * recorder (a later phase) owns when to start()/stop() this.
 */

export type WakeLockStatus =
  | "idle"
  | "active"
  | "released"
  | "unsupported"
  | "error";

export function isWakeLockSupported(): boolean {
  return typeof navigator !== "undefined" && "wakeLock" in navigator;
}

export class WakeLockController {
  private sentinel: WakeLockSentinel | null = null;
  private wantActive = false;
  private status: WakeLockStatus = "idle";
  private readonly onChange?: (status: WakeLockStatus) => void;

  constructor(onChange?: (status: WakeLockStatus) => void) {
    this.onChange = onChange;
    if (!isWakeLockSupported()) this.setStatus("unsupported");
  }

  getStatus(): WakeLockStatus {
    return this.status;
  }

  private setStatus(status: WakeLockStatus): void {
    this.status = status;
    this.onChange?.(status);
  }

  async start(): Promise<void> {
    if (!isWakeLockSupported()) {
      this.setStatus("unsupported");
      return;
    }
    this.wantActive = true;
    document.addEventListener("visibilitychange", this.handleVisibility);
    await this.acquire();
  }

  async stop(): Promise<void> {
    this.wantActive = false;
    document.removeEventListener("visibilitychange", this.handleVisibility);
    await this.release();
    if (this.status !== "unsupported") this.setStatus("released");
  }

  private acquire = async (): Promise<void> => {
    if (!this.wantActive || this.sentinel) return;
    // A lock can only be acquired while the document is visible; the
    // visibilitychange handler retries once we're foregrounded again.
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      return;
    }
    try {
      this.sentinel = await navigator.wakeLock.request("screen");
      this.sentinel.addEventListener("release", this.handleRelease);
      this.setStatus("active");
    } catch {
      this.sentinel = null;
      this.setStatus("error");
    }
  };

  private release = async (): Promise<void> => {
    const sentinel = this.sentinel;
    this.sentinel = null;
    if (sentinel) {
      sentinel.removeEventListener("release", this.handleRelease);
      try {
        await sentinel.release();
      } catch {
        // Already released by the platform — nothing to do.
      }
    }
  };

  private handleRelease = (): void => {
    // The platform dropped the lock (tab hidden, OS power event, etc.).
    this.sentinel = null;
    if (!this.wantActive) return;
    this.setStatus("released");
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      void this.acquire();
    }
  };

  private handleVisibility = (): void => {
    if (this.wantActive && document.visibilityState === "visible") {
      void this.acquire();
    }
  };
}
