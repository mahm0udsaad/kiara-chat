/**
 * Whether a specialist finished when the booking said she would.
 *
 * The owner's rule: the visit is expected to end at the booking time plus the
 * durations of every service booked in it, added up. Her «إنهاء الخدمة» tap is
 * compared with that moment. Her «بدء الخدمة» tap plays no part — a late start
 * that still ends on time is on time, and an on-time start that overruns is
 * not. Pure, so the reports and tests share it.
 */

export type ServiceTiming = {
  /** The booking time of the visit. */
  bookedAt: string;
  /** The booked services' durations, added up. */
  bookedMinutes: number;
  /** bookedAt + bookedMinutes. */
  expectedEndAt: string;
  /** Her «إنهاء الخدمة» tap. */
  completedAt: string;
  /** Whole minutes from the expected end to her tap: positive after, negative before. */
  varianceMinutes: number;
  /**
   * "unreliable": tapped hours after the expected end — the tap was forgotten
   * and pressed later, so it says nothing about when she finished. Counted
   * apart so it neither flatters nor condemns her.
   */
  verdict: "on_time" | "late" | "early" | "unreliable";
};

export type SpecialistServiceTiming = {
  /** Visits with an end tap; the rest cannot be judged. */
  timed: number;
  onTime: number;
  late: number;
  early: number;
  /** End tapped hours late; not in the three above. */
  unreliable: number;
  /** Median minutes past the expected end of the late ones, null when none. */
  medianLateMinutes: number | null;
};

/**
 * How far from the expected end a tap may land and still count as on time.
 * None, by the owner's rule — the same exactness as the driver's arrival: a
 * full minute after the expected end is late, a full minute before is early.
 */
export const SERVICE_TOLERANCE_MINUTES = 0;
/** Past the expected end by more than this, the end tap was forgotten. */
export const MAX_PLAUSIBLE_OVERRUN_MINUTES = 180;

export function serviceTimingOf(
  bookedAt: string,
  bookedMinutes: number,
  completedAt: string | null | undefined,
): ServiceTiming | null {
  const startMs = Date.parse(bookedAt);
  const endMs = completedAt ? Date.parse(completedAt) : NaN;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !completedAt) return null;
  const expectedEndMs = startMs + Math.max(bookedMinutes, 0) * 60_000;
  const varianceMinutes = Math.trunc((endMs - expectedEndMs) / 60_000);
  return {
    bookedAt,
    bookedMinutes,
    expectedEndAt: new Date(expectedEndMs).toISOString(),
    completedAt,
    varianceMinutes,
    verdict:
      varianceMinutes > MAX_PLAUSIBLE_OVERRUN_MINUTES
        ? "unreliable"
        : varianceMinutes > SERVICE_TOLERANCE_MINUTES
          ? "late"
          : varianceMinutes < -SERVICE_TOLERANCE_MINUTES
            ? "early"
            : "on_time",
  };
}

export function summarizeServiceTimings(timings: ServiceTiming[]): SpecialistServiceTiming {
  const lateBy = timings
    .filter((timing) => timing.verdict === "late")
    .map((timing) => timing.varianceMinutes)
    .sort((a, b) => a - b);
  const middle = lateBy.length >> 1;
  return {
    timed: timings.length,
    onTime: timings.filter((timing) => timing.verdict === "on_time").length,
    late: lateBy.length,
    early: timings.filter((timing) => timing.verdict === "early").length,
    unreliable: timings.filter((timing) => timing.verdict === "unreliable").length,
    medianLateMinutes: !lateBy.length
      ? null
      : lateBy.length % 2
        ? lateBy[middle]!
        : Math.round((lateBy[middle - 1]! + lateBy[middle]!) / 2),
  };
}
