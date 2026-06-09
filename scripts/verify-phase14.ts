/**
 * Phase 14 unit verification — interruption detection + multi-channel
 * notification, against FAKE channels + a fake clock + a fake document. Imports
 * the REAL app modules (no re-implementation, per the standing rule). The parts a
 * headless run can't exercise — the actual chime through speakers, a real Web
 * Push to a locked iPhone, a real mic track ending — are the on-device gate
 * (Felix). This proves the decision logic + the channel plumbing deterministically.
 *
 * Run: pnpm tsx scripts/verify-phase14.ts
 */
import {
  InterruptionMonitor,
  deriveInterrupted,
  type InterruptionChannels,
  type InterruptionSignal,
} from "../src/lib/recording/interruption";
import {
  createTabTitleChannel,
  INTERRUPTION_TITLE,
  type TitleDoc,
} from "../src/lib/recording/tabTitle";
import { createChimeChannel } from "../src/lib/recording/chime";
import { createPushChannel } from "../src/lib/recording/pushClient";
import {
  parseSubscription,
} from "../src/lib/push/subscriptions";
import { INTERRUPTION_PUSH_PAYLOAD } from "../src/lib/push/webpush";
import {
  SegmentedRecorder,
  type RecorderEngine,
  type RecorderTimers,
  type SegmentRecorderHandle,
  type SegmentRecorderOptions,
  type MicStream,
  type TimerHandle,
} from "../src/lib/recording/segmentedRecorder";

const fails: string[] = [];
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) fails.push(msg);
};
const realTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// ---- a counting fake channel ----
function fakeChannel() {
  const c = { raises: 0, clears: 0 };
  return {
    channel: {
      raise: () => {
        c.raises += 1;
      },
      clear: () => {
        c.clears += 1;
      },
    },
    counts: c,
  };
}
function fakeChannels() {
  const chime = fakeChannel();
  const tabTitle = fakeChannel();
  const push = fakeChannel();
  const banner = fakeChannel();
  const channels: InterruptionChannels = {
    chime: chime.channel,
    tabTitle: tabTitle.channel,
    push: push.channel,
    banner: banner.channel,
  };
  return { channels, chime, tabTitle, push, banner };
}

const REC = (over: Partial<InterruptionSignal> = {}): InterruptionSignal => ({
  status: "recording",
  recoveryTier: 0,
  heartbeat: { healthy: true, lastChunkAgeMs: 0, recorderState: "recording", trackLive: true },
  ...over,
});
const INTERRUPT: InterruptionSignal = {
  status: "recovering",
  recoveryTier: 2,
  heartbeat: { healthy: false, lastChunkAgeMs: 9000, recorderState: "recording", trackLive: false },
};

async function main() {
  // ============================================================
  // A. deriveInterrupted — the pure predicate.
  // ============================================================
  ok(deriveInterrupted({ status: "error", recoveryTier: 4, heartbeat: null }) === true,
    "derive: fatal error → interrupted");
  ok(deriveInterrupted(INTERRUPT) === true,
    "derive: recovering + dead track → interrupted (mic grabbed)");
  ok(
    deriveInterrupted({
      status: "recovering",
      recoveryTier: 1,
      heartbeat: { healthy: false, lastChunkAgeMs: 9000, recorderState: "inactive", trackLive: true },
    }) === false,
    "derive: recovering with a LIVE track (Tier-1 recorder hiccup) → NOT interrupted (no cry-wolf)",
  );
  ok(deriveInterrupted(REC()) === false, "derive: healthy recording → not interrupted");
  ok(deriveInterrupted({ status: "requesting", recoveryTier: 0, heartbeat: null }) === false,
    "derive: requesting permission → not interrupted");

  // ============================================================
  // B. InterruptionMonitor — arming + edges + idempotency.
  // ============================================================
  {
    // Permission-deny path must NOT alert: requesting → error, never recorded.
    const f = fakeChannels();
    const m = new InterruptionMonitor(f.channels);
    m.update({ status: "requesting", recoveryTier: 0, heartbeat: null });
    m.update({ status: "error", recoveryTier: 0, heartbeat: null });
    ok(
      f.chime.counts.raises === 0 && f.banner.counts.raises === 0,
      "monitor: an initial failure (denied mic, never recorded) raises NO alert",
    );
  }
  {
    const f = fakeChannels();
    const changes: boolean[] = [];
    const m = new InterruptionMonitor(f.channels, { onChange: (a) => changes.push(a) });

    m.update(REC({ heartbeat: null })); // first recording beat → arm, no alert
    ok(f.chime.counts.raises === 0 && !m.isActive(),
      "monitor: arming on first recording beat does not alert");

    m.update(INTERRUPT); // interruption edge → raise all four once
    ok(
      f.chime.counts.raises === 1 &&
        f.tabTitle.counts.raises === 1 &&
        f.push.counts.raises === 1 &&
        f.banner.counts.raises === 1 &&
        m.isActive(),
      "monitor: interruption edge raises all four channels exactly once",
    );

    m.update(INTERRUPT); // still interrupted → idempotent, no re-raise
    ok(f.chime.counts.raises === 1 && f.push.counts.raises === 1,
      "monitor: a sustained interruption does not re-raise (idempotent)");

    m.update(REC()); // healthy recording again → clear all once
    ok(
      f.chime.counts.clears === 1 &&
        f.tabTitle.counts.clears === 1 &&
        f.push.counts.clears === 1 &&
        f.banner.counts.clears === 1 &&
        !m.isActive(),
      "monitor: recovery clears all four channels exactly once",
    );
    ok(
      changes.length === 2 && changes[0] === true && changes[1] === false,
      "monitor: onChange fired true then false (one full interruption cycle)",
    );
  }
  {
    // track.onended gives an IMMEDIATE raise, held until a healthy beat.
    const f = fakeChannels();
    const m = new InterruptionMonitor(f.channels);
    m.update(REC()); // arm
    m.signalTrackEnded(); // immediate, before any heartbeat
    ok(m.isActive() && f.tabTitle.counts.raises === 1,
      "monitor: track.onended raises immediately (faster than the heartbeat)");
    // The heartbeat then confirms the dead track — still one raise, no flap.
    m.update(INTERRUPT);
    ok(f.tabTitle.counts.raises === 1,
      "monitor: the confirming heartbeat does not double-raise the track-ended alert");
    m.update(REC()); // recovered
    ok(!m.isActive() && f.tabTitle.counts.clears === 1,
      "monitor: a healthy beat clears the track-ended alert");
  }
  {
    // A clean user stop clears any active alert.
    const f = fakeChannels();
    const m = new InterruptionMonitor(f.channels);
    m.update(REC());
    m.update(INTERRUPT);
    ok(m.isActive(), "monitor: interrupted before stop");
    m.update({ status: "stopped", recoveryTier: 0, heartbeat: null });
    ok(!m.isActive() && f.banner.counts.clears === 1,
      "monitor: a clean stop clears the alert");
  }
  {
    // signalTrackEnded before arming is ignored (nothing to interrupt yet).
    const f = fakeChannels();
    const m = new InterruptionMonitor(f.channels);
    m.signalTrackEnded();
    ok(!m.isActive() && f.chime.counts.raises === 0,
      "monitor: track-ended before any recording is ignored");
  }

  // ============================================================
  // C. Tab-title channel — flashes branded, restores on clear, BRANDING-ONLY.
  // ============================================================
  {
    const doc: TitleDoc = { title: "Recording test · Critiq" };
    const box: { fn: (() => void) | null } = { fn: null };
    const timers = {
      setInterval: (fn: () => void) => {
        box.fn = fn;
        return 1 as unknown as ReturnType<typeof setInterval>;
      },
      clearInterval: () => {
        box.fn = null;
      },
    };
    const original = doc.title;
    const ch = createTabTitleChannel(doc, timers);
    ch.raise();
    ok(doc.title === INTERRUPTION_TITLE,
      "tabTitle: raise shows the branded alert title immediately");
    box.fn?.(); // tick → flips back to original
    ok(doc.title === original, "tabTitle: it flashes back to the real title");
    box.fn?.(); // tick → alert again
    ok(doc.title === INTERRUPTION_TITLE, "tabTitle: …and back to the alert (flashing)");
    ch.clear();
    ok(doc.title === original && box.fn === null,
      "tabTitle: clear restores the real title and stops flashing");
    ok(
      !/recording/i.test(INTERRUPTION_TITLE) && /critiq/i.test(INTERRUPTION_TITLE),
      "tabTitle: BRANDING-ONLY — the alert title has no 'recording', and is branded Critiq",
    );
  }

  // ============================================================
  // D. Privacy contract — the push payload is branding-only.
  // ============================================================
  {
    const json = JSON.stringify(INTERRUPTION_PUSH_PAYLOAD);
    ok(INTERRUPTION_PUSH_PAYLOAD.title === "Critiq",
      "push payload: title is the neutral brand 'Critiq'");
    ok(!/recording/i.test(json),
      "push payload: BRANDING-ONLY — no 'recording' anywhere in the payload");
  }

  // ============================================================
  // E. Subscription parsing — validation guards.
  // ============================================================
  {
    const valid = parseSubscription({
      endpoint: "https://push.example.com/abc",
      keys: { p256dh: "k1", auth: "k2" },
      expirationTime: null,
    });
    ok(
      !!valid && valid.endpoint === "https://push.example.com/abc" &&
        valid.p256dh === "k1" && valid.auth === "k2",
      "parseSubscription: a valid PushSubscription JSON is accepted",
    );
    ok(parseSubscription({ endpoint: "x", keys: { p256dh: "k1" } }) === null,
      "parseSubscription: missing auth key → rejected");
    ok(parseSubscription({ keys: { p256dh: "k1", auth: "k2" } }) === null,
      "parseSubscription: missing endpoint → rejected");
    ok(parseSubscription("nope") === null, "parseSubscription: non-object → rejected");
    ok(
      parseSubscription({ endpoint: "x".repeat(5000), keys: { p256dh: "k1", auth: "k2" } }) === null,
      "parseSubscription: oversized endpoint → rejected",
    );
  }

  // ============================================================
  // F. Browser-channel constructors are safe headless (no window/AudioContext).
  // ============================================================
  {
    const chime = createChimeChannel();
    chime.raise(); // no AudioContext in node → must no-op, not throw
    chime.clear();
    const push = createPushChannel();
    ok(typeof push.raise === "function" && typeof push.clear === "function",
      "channels: chime + push constructors are headless-safe (no throw, right shape)");
  }

  // ============================================================
  // G. SegmentedRecorder track.onended seam wires through to onTrackEnded.
  // ============================================================
  {
    const endedBox: { cb: (() => void) | null } = { cb: null };
    const stream: MicStream = {
      isLive: () => true,
      stop: () => {},
      onEnded: (cb) => {
        endedBox.cb = cb;
      },
    };
    const noopTimers: RecorderTimers = {
      now: () => 0,
      setTimeout: () => 0 as TimerHandle,
      clearTimeout: () => {},
      setInterval: () => 0 as TimerHandle,
      clearInterval: () => {},
    };
    const engine: RecorderEngine = {
      isSupported: () => true,
      pickMimeType: () => "audio/webm",
      acquireStream: async () => stream,
      createSegmentRecorder: (
        _s,
        _opts: SegmentRecorderOptions,
      ): SegmentRecorderHandle => ({
        start: () => {},
        stop: async () => {},
        getState: () => "recording",
      }),
    };
    let trackEnded = 0;
    const rec = new SegmentedRecorder(
      { onChunk: () => {}, onTrackEnded: () => (trackEnded += 1) },
      { engine, timers: noopTimers },
    );
    await rec.start();
    await realTick();
    ok(endedBox.cb !== null, "recorder: start() registered a track-ended listener on the stream");
    endedBox.cb?.(); // simulate the mic track ending
    ok(trackEnded === 1, "recorder: a track ending fires onTrackEnded (the Phase 14 seam)");
    await rec.stop();
  }

  if (fails.length) {
    console.error(`\n✗ ${fails.length} assertion(s) failed.`);
    process.exit(1);
  }
  console.log("\n✓ Phase 14 unit verification PASSED.");
}

main().catch((e) => {
  console.error("PROBE ERROR:", e);
  process.exit(1);
});
