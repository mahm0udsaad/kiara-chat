/**
 * Pure helpers behind the order screen's driver-tracking section: what the GPS
 * trail says about a trip, and when the driver should reach the next stop.
 *
 * No I/O here, so the arithmetic can be checked on its own. Everything is an
 * estimate built from whatever fixes arrived — a phone that sent none still
 * produces a valid (empty) answer, never an error.
 */
import { metresBetween, type Point } from "@/lib/punctuality-core";

export type TrackFix = {
  lat: number;
  lng: number;
  /** ISO capture time on the phone. */
  at: string;
  accuracyMeters: number;
  speedMps: number | null;
};

export type TrackStats = {
  /** Driven distance along the trail, jitter and impossible jumps removed. */
  distanceMetres: number;
  fixes: number;
  /** Share of the trip (0–1) with a fix at least every few minutes; null before the trip. */
  coverage: number | null;
  longestGapSeconds: number | null;
  /** Mean moving speed from the phone's own speed readings, km/h. */
  averageSpeedKph: number | null;
};

/** A fix vaguer than this says nothing useful about the route. */
export const USABLE_ACCURACY_METRES = 100;
/** Two fixes further apart than this leave a hole in the trail. */
export const GAP_SECONDS = 180;
/** Faster than this between two fixes is a GPS jump, not driving. */
const MAX_PLAUSIBLE_MPS = 55;

const ms = (iso: string) => Date.parse(iso);

export function usableFixes(fixes: TrackFix[]): TrackFix[] {
  return fixes
    .filter((fix) => Number.isFinite(ms(fix.at)) && fix.accuracyMeters <= USABLE_ACCURACY_METRES)
    .sort((a, b) => ms(a.at) - ms(b.at));
}

/** Keeps the first and last fix and an even spread between, at most `max`. */
export function downsample<T>(items: T[], max: number): T[] {
  if (items.length <= max || max < 2) return items;
  const step = (items.length - 1) / (max - 1);
  const out: T[] = [];
  for (let index = 0; index < max; index += 1) out.push(items[Math.round(index * step)]);
  return out;
}

/**
 * Distance, coverage and gaps over one trip window.
 *
 * `fromMs`–`toMs` is the stretch the phone was expected to report (trip start
 * to arrival, or to now while it runs). Coverage is the share of that window
 * within GAP_SECONDS of a fix, so a trail that went silent for twenty minutes
 * reads as patchy rather than complete.
 */
export function trackStats(
  fixes: TrackFix[],
  window: { fromMs: number | null; toMs: number | null },
): TrackStats {
  const usable = usableFixes(fixes);
  let distance = 0;
  for (let index = 1; index < usable.length; index += 1) {
    const a = usable[index - 1];
    const b = usable[index];
    const metres = metresBetween(a, b);
    const seconds = (ms(b.at) - ms(a.at)) / 1_000;
    // Movement inside the combined error radius is GPS wander, not driving.
    if (metres <= Math.max(a.accuracyMeters, b.accuracyMeters)) continue;
    if (seconds > 0 && metres / seconds > MAX_PLAUSIBLE_MPS) continue;
    distance += metres;
  }

  const speeds = usable
    .map((fix) => fix.speedMps)
    .filter((speed): speed is number => speed != null && speed >= 1.5);
  const averageSpeedKph = speeds.length
    ? Math.round((speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length) * 3.6)
    : null;

  const { fromMs, toMs } = window;
  if (fromMs == null || toMs == null || toMs <= fromMs) {
    return { distanceMetres: Math.round(distance), fixes: usable.length, coverage: null, longestGapSeconds: null, averageSpeedKph };
  }
  const inside = usable.map((fix) => ms(fix.at)).filter((at) => at >= fromMs - 60_000 && at <= toMs + 60_000);
  const marks = [fromMs, ...inside, toMs].sort((a, b) => a - b);
  let covered = 0;
  let longest = 0;
  // Each fix vouches for GAP_SECONDS either side of it; the window edges vouch
  // for nothing, so a trip with no fixes at all has zero coverage.
  for (let index = 1; index < marks.length; index += 1) {
    const gap = marks[index] - marks[index - 1];
    longest = Math.max(longest, gap);
    const edges = (index - 1 === 0 ? 0 : 1) + (index === marks.length - 1 ? 0 : 1);
    covered += Math.min(gap, edges * GAP_SECONDS * 1_000);
  }
  return {
    distanceMetres: Math.round(distance),
    fixes: usable.length,
    coverage: Math.max(0, Math.min(1, covered / (toMs - fromMs))),
    longestGapSeconds: Math.round(longest / 1_000),
    averageSpeedKph,
  };
}

/**
 * The speed to plan the rest of the drive with, km/h.
 *
 * The phone's own moving speed over the last ten minutes when it has one —
 * that already folds in this afternoon's traffic — clamped so a red light or a
 * motorway burst does not swing the estimate wildly; the configured city
 * average otherwise.
 */
export function plannedSpeedKph(fixes: TrackFix[], nowMs: number, fallbackKph: number): {
  kph: number;
  live: boolean;
} {
  const recent = usableFixes(fixes)
    .filter((fix) => nowMs - ms(fix.at) <= 10 * 60_000)
    .map((fix) => fix.speedMps)
    .filter((speed): speed is number => speed != null && speed >= 1.5);
  if (recent.length < 3) return { kph: fallbackKph, live: false };
  const kph = (recent.reduce((sum, speed) => sum + speed, 0) / recent.length) * 3.6;
  return { kph: Math.max(18, Math.min(70, kph)), live: true };
}

/** The fix nearest in time to `atMs`, if one lies within `withinMs`. */
export function fixNear(fixes: TrackFix[], atMs: number, withinMs = 3 * 60_000): TrackFix | null {
  let best: TrackFix | null = null;
  let bestGap = Infinity;
  for (const fix of usableFixes(fixes)) {
    const gap = Math.abs(ms(fix.at) - atMs);
    if (gap < bestGap) {
      best = fix;
      bestGap = gap;
    }
  }
  return best && bestGap <= withinMs ? best : null;
}

/** Metres from the fix nearest a tap to where the tap claims the driver was. */
export function tapDistanceFrom(
  fixes: TrackFix[],
  tapAt: string | null,
  target: Point | null,
): number | null {
  if (!tapAt || !target) return null;
  const fix = fixNear(fixes, ms(tapAt));
  return fix ? metresBetween(fix, target) : null;
}
