/**
 * Tab-title flash (Phase 14, channel b). While capture is interrupted, the
 * document title alternates between the page's real title and a branded alert,
 * so a rep who has tabbed away sees "⚠ Critiq …" pulsing in the tab strip / OS
 * app switcher and comes back.
 *
 * PRIVACY: the title is visible outside the app (tab bar, task switcher), so it
 * is BRANDING-ONLY — never the word "recording" and never call content.
 *
 * Injectable doc handle so the state machine is testable headless; the default
 * binds to the real document.
 */
import type { NotificationChannel } from "./interruption";

/** Branding-only alert title. No "recording", no call content. */
export const INTERRUPTION_TITLE = "⚠ Critiq needs you";
const FLASH_MS = 1000;

export interface TitleDoc {
  get title(): string;
  set title(value: string);
}

interface TitleTimers {
  setInterval(fn: () => void, ms: number): ReturnType<typeof setInterval>;
  clearInterval(h: ReturnType<typeof setInterval>): void;
}

const defaultTimers: TitleTimers = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h),
};

export function createTabTitleChannel(
  doc?: TitleDoc,
  timers: TitleTimers = defaultTimers,
): NotificationChannel {
  const target: TitleDoc | null =
    doc ?? (typeof document !== "undefined" ? (document as TitleDoc) : null);

  let original: string | null = null;
  let handle: ReturnType<typeof setInterval> | null = null;
  let showingAlert = false;

  return {
    raise() {
      if (!target || handle !== null) return;
      original = target.title;
      showingAlert = false;
      const flip = () => {
        showingAlert = !showingAlert;
        target.title = showingAlert ? INTERRUPTION_TITLE : (original ?? "");
      };
      flip(); // show the alert immediately, don't wait a full interval
      handle = timers.setInterval(flip, FLASH_MS);
    },
    clear() {
      if (handle !== null) {
        timers.clearInterval(handle);
        handle = null;
      }
      if (target && original !== null) target.title = original;
      original = null;
      showingAlert = false;
    },
  };
}
