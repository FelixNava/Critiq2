"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  SessionKeepAlive,
  type KeepAliveLayers,
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

const INITIAL_LAYERS: KeepAliveLayers = {
  wakeLock: "idle",
  silentAudio: "idle",
  mediaSession: "idle",
};

export function useSessionKeepAlive(): UseSessionKeepAlive {
  const ref = useRef<SessionKeepAlive | null>(null);
  const [layers, setLayers] = useState<KeepAliveLayers>(INITIAL_LAYERS);
  const [active, setActive] = useState(false);

  useEffect(() => {
    // Construct on the client only — feature detection touches navigator/window.
    const manager = new SessionKeepAlive(setLayers);
    ref.current = manager;
    // Pick up any "unsupported" the constructor detected up front.
    setLayers(manager.getLayers());
    return () => {
      void manager.stop();
      ref.current = null;
    };
  }, []);

  const start = useCallback(async () => {
    const manager = ref.current;
    if (!manager) return;
    await manager.start();
    setActive(manager.isActive());
  }, []);

  const stop = useCallback(async () => {
    const manager = ref.current;
    if (!manager) return;
    await manager.stop();
    setActive(manager.isActive());
  }, []);

  return { active, layers, start, stop };
}
