/**
 * How far this phone's clock is from the server's.
 *
 * Login tokens carry an expiry time set by the server, and the app compares it
 * with the phone's own clock. On a phone set an hour fast every fresh token
 * already looks expired, so each API call renewed it again — twice a second on
 * one phone in November 2026, which loaded the server and database for
 * everyone. Measuring the offset from the server's `Date` header lets the app
 * judge expiry on the server's time and tell the employee to fix the clock.
 */

/** Below this, a difference is network delay and rounding, not a wrong clock. */
export const CLOCK_SKEW_WARN_MS = 2 * 60_000;
const SAMPLES = 5;

/**
 * One offset reading from a response. `Date` has one-second resolution and
 * describes some moment during the request, so the midpoint is the best guess.
 */
export function offsetFromResponse(
  dateHeader: string | null,
  sentAtMs: number,
  receivedAtMs: number,
): number | null {
  if (!dateHeader) return null;
  const serverMs = Date.parse(dateHeader);
  if (!Number.isFinite(serverMs)) return null;
  return serverMs + 500 - (sentAtMs + receivedAtMs) / 2;
}

/** The median of recent readings, so one slow response cannot swing it. */
export function medianOffset(samples: readonly number[]): number {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

let samples: number[] = [];
let offsetMs = 0;
let skewed = false;
const listeners = new Set<() => void>();

export function recordServerDate(
  dateHeader: string | null,
  sentAtMs: number,
  receivedAtMs: number,
) {
  const reading = offsetFromResponse(dateHeader, sentAtMs, receivedAtMs);
  if (reading === null) return;
  samples = [...samples.slice(-(SAMPLES - 1)), reading];
  offsetMs = medianOffset(samples);
  const nextSkewed = Math.abs(offsetMs) > CLOCK_SKEW_WARN_MS;
  if (nextSkewed !== skewed) {
    skewed = nextSkewed;
    for (const listener of listeners) listener();
  }
}

/** Milliseconds since the epoch on the server's clock, as best we know it. */
export function serverNow(): number {
  return Date.now() + offsetMs;
}

/** Server time minus phone time; positive when the phone is behind. */
export function clockOffsetMs(): number {
  return offsetMs;
}

export function subscribeClockSkew(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isClockSkewed(): boolean {
  return skewed;
}
