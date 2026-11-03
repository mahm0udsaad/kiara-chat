/**
 * Is this phone's connection good enough right now?
 *
 * Judged from the app's own requests (no native network library needed, so it
 * ships over OTA): several slow answers or timeouts in a row read as "slow",
 * requests that fail before reaching the server read as "offline". One slow
 * request is not enough, and coming back needs two quick answers, so the
 * banner does not flicker on a single hiccup.
 */

export type ConnectionQuality = "good" | "slow" | "offline";
export type RequestOutcome = "ok" | "http_error" | "timeout" | "network";

type Sample = { at: number; ms: number; outcome: RequestOutcome };

/** A request slower than this counts against the connection. */
export const SLOW_MS = 4_000;
/** Answers at or under this count as quick when deciding to recover. */
const QUICK_MS = 2_000;
/** Older samples are forgotten; an idle phone drifts back to "good". */
const WINDOW_MS = 90_000;
const MAX_SAMPLES = 8;

export class ConnectionQualityTracker {
  private samples: Sample[] = [];
  private current: ConnectionQuality = "good";

  record(ms: number, outcome: RequestOutcome, now = Date.now()): ConnectionQuality {
    this.samples.push({ at: now, ms, outcome });
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
    return this.evaluate(now);
  }

  /** Re-judge without a new sample, e.g. so an idle phone stops showing the banner. */
  evaluate(now = Date.now()): ConnectionQuality {
    this.samples = this.samples.filter((sample) => now - sample.at <= WINDOW_MS);
    this.current = judge(this.samples, this.current);
    return this.current;
  }

  get quality(): ConnectionQuality {
    return this.current;
  }
}

function judge(samples: Sample[], previous: ConnectionQuality): ConnectionQuality {
  if (!samples.length) return "good";
  const lastTwo = samples.slice(-2);

  if (lastTwo.length === 2 && lastTwo.every((sample) => sample.outcome === "network")) {
    return "offline";
  }

  // Recovery: two quick answers in a row clear either warning.
  const recovered =
    lastTwo.length === 2 &&
    lastTwo.every(
      (sample) =>
        (sample.outcome === "ok" || sample.outcome === "http_error") && sample.ms <= QUICK_MS,
    );
  if (recovered) return "good";

  const recent = samples.slice(-5);
  const timeouts = recent.filter((sample) => sample.outcome === "timeout").length;
  const slow = recent.filter(
    (sample) => sample.outcome === "timeout" || sample.ms >= SLOW_MS,
  ).length;
  if (timeouts >= 2 || slow >= 3) return "slow";

  // Not bad enough to raise a warning, not good enough to clear one.
  return previous === "good" ? "good" : previous;
}

// One tracker for the whole app, read through useConnectionQuality().
const tracker = new ConnectionQualityTracker();
const listeners = new Set<() => void>();
let decayTimer: ReturnType<typeof setTimeout> | null = null;

function publish(next: ConnectionQuality, before: ConnectionQuality) {
  if (next !== before) for (const listener of listeners) listener();
  // A warning with no further requests would otherwise stay up forever.
  if (decayTimer) clearTimeout(decayTimer);
  if (next !== "good") {
    decayTimer = setTimeout(() => {
      const prior = tracker.quality;
      publish(tracker.evaluate(), prior);
    }, WINDOW_MS + 1_000);
  }
}

export function recordConnectionSample(ms: number, outcome: RequestOutcome) {
  try {
    const before = tracker.quality;
    publish(tracker.record(ms, outcome), before);
  } catch {
    // Never let the warning get in the way of the request itself.
  }
}

export function subscribeConnectionQuality(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function currentConnectionQuality(): ConnectionQuality {
  return tracker.quality;
}
