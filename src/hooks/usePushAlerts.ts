"use client";

import { useCallback, useEffect, useState } from "react";
import {
  enablePush,
  disablePush,
  pushSupport,
  notificationPermission,
  type PushSupport,
} from "@/lib/recording/pushClient";

/**
 * Manages the rep's opt-in to Web Push interruption alerts (Phase 14, channel c).
 * Detects platform support (incl. the iOS "install as a PWA first" case),
 * surfaces the current permission, and exposes enable/disable. The actual
 * interruption push is sent by the recorder's monitor (POST /api/push/notify);
 * this only manages the subscription.
 */

export type PushUiState =
  | "checking"
  | "unsupported"
  | "needs-install"
  | "off" // supported, not yet subscribed / permission not granted
  | "on" // subscribed
  | "denied"; // permission was denied

export interface UsePushAlerts {
  state: PushUiState;
  support: PushSupport | null;
  message: string | null;
  busy: boolean;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
}

export function usePushAlerts(): UsePushAlerts {
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [state, setState] = useState<PushUiState>("checking");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const s = pushSupport();
    setSupport(s);
    if (s === "unsupported") {
      setState("unsupported");
      return;
    }
    if (s === "needs-install") {
      setState("needs-install");
      return;
    }
    const perm = notificationPermission();
    if (perm === "denied") setState("denied");
    else setState("off");
  }, []);

  const enable = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await enablePush();
      if (result.ok) {
        setState("on");
        setMessage("Alerts are on for this device.");
        return;
      }
      switch (result.reason) {
        case "needs-install":
          setState("needs-install");
          break;
        case "unsupported":
          setState("unsupported");
          break;
        case "denied":
          setState("denied");
          setMessage("Notifications are blocked. Allow them in your browser settings.");
          break;
        case "unconfigured":
          setMessage("Alerts aren't available yet. Try the other signals for now.");
          break;
        default:
          setMessage("Couldn't turn on alerts. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      await disablePush();
      setState("off");
      setMessage(null);
    } finally {
      setBusy(false);
    }
  }, []);

  return { state, support, message, busy, enable, disable };
}
