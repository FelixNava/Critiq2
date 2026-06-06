/**
 * Session keep-alive — Recording Infrastructure Layers 1-3, combined.
 *
 * One on/off seam over Wake Lock (L1), silent keep-alive audio (L2), and media-
 * session presence (L3). The recorder (a later phase) owns when to start/stop
 * this: it calls start() the instant capture begins and stop() when it ends, so
 * the keep-alive lifetime exactly tracks the capture lifetime.
 *
 * This module holds NO audio capture itself — it only keeps the page/session
 * alive around it. Each layer fails independently and gracefully; one
 * unsupported layer never blocks the others.
 */

import {
  WakeLockController,
  type WakeLockStatus,
} from "./wakeLock";
import {
  SilentAudioController,
  type SilentAudioStatus,
} from "./silentAudio";
import {
  MediaSessionController,
  type MediaSessionStatus,
} from "./mediaSession";

export interface KeepAliveLayers {
  wakeLock: WakeLockStatus;
  silentAudio: SilentAudioStatus;
  mediaSession: MediaSessionStatus;
}

export type KeepAliveListener = (layers: KeepAliveLayers) => void;

export class SessionKeepAlive {
  private readonly wakeLock: WakeLockController;
  private readonly silentAudio: SilentAudioController;
  private readonly mediaSession: MediaSessionController;
  private layers: KeepAliveLayers;
  private active = false;
  private readonly listener?: KeepAliveListener;

  constructor(listener?: KeepAliveListener) {
    this.listener = listener;
    this.wakeLock = new WakeLockController((s) => this.patch({ wakeLock: s }));
    this.silentAudio = new SilentAudioController((s) =>
      this.patch({ silentAudio: s }),
    );
    this.mediaSession = new MediaSessionController((s) =>
      this.patch({ mediaSession: s }),
    );
    this.layers = {
      wakeLock: this.wakeLock.getStatus(),
      silentAudio: this.silentAudio.getStatus(),
      mediaSession: this.mediaSession.getStatus(),
    };
  }

  isActive(): boolean {
    return this.active;
  }

  getLayers(): KeepAliveLayers {
    return { ...this.layers };
  }

  private patch(partial: Partial<KeepAliveLayers>): void {
    this.layers = { ...this.layers, ...partial };
    this.listener?.(this.getLayers());
  }

  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    // Media session is synchronous; the other two are async + independent.
    this.mediaSession.start();
    await Promise.all([this.wakeLock.start(), this.silentAudio.start()]);
  }

  async stop(): Promise<void> {
    if (!this.active) return;
    this.active = false;
    this.mediaSession.clear();
    await Promise.all([this.wakeLock.stop(), this.silentAudio.stop()]);
  }
}
