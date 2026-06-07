"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  SessionKeepAlive,
  type KeepAliveLayers,
  type KeepAliveState,
} from "@/lib/recording/sessionKeepAlive";

/**
 * React wrapper over {@link SessionKeepAlive}. Owns one keep-alive instance for
 * the component's lifetime, mirrors its per-layer status into state, and tears
 * everything down on unmount (releasing the wake lock, closing the audio
 * context, and clearing the media-session presence). The recorder UI in a later
 * phase consumes this; for now it backs the device check surface.
 */
export interface UseSessionKeepAlive {
  active: boolean;
  layers: KeepAliveLayers;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

const INITIAL_STATE: KeepAliveState = {
  active: false,
  layers: { wakeLock: "idle", silentAudio: "idle", mediaSession: "idle" },
};

export function useSessionKeepAlive(): UseSessionKeepAlive {
  const ref = useRef<SessionKeepAlive | null>(null);
  const [state, setState] = useState<KeepAliveState>(INITIAL_STATE);

  useEffect(() => {
    // Construct on the client only — feature detection touches navigator/window.
    // active + layers both arrive through this one listener, so there's no
    // second source of truth to keep in sync.
    const manager = new SessionKeepAlive(setState);
    ref.current = manager;
    // Pick up any "unsupported" the constructor detected up front.
    setState(manager.getState());
    return () => {
      void manager.stop();
      ref.current = null;
    };
  }, []);

  const start = useCallback(async () => {
    await ref.current?.start();
  }, []);

  const stop = useCallback(async () => {
    await ref.current?.stop();
  }, []);

  return { active: state.active, layers: state.layers, start, stop };
}
