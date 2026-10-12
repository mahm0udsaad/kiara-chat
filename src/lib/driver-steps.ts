/**
 * A driver's trip judged at the two moments he confirms himself: «وصلت
 * للأخصائية» and «وصلت للعميلة».
 *
 * The routed punctuality plan would be the better yardstick, but it needs a
 * pin for the specialist's pickup point and one for the client, and most trips
 * have neither. The two confirmations are on nearly every trip, so the report
 * measures those against times that always exist:
 *
 *   at the client      the appointment itself
 *   at the specialist  the plan's time when there is a plan, otherwise a fixed
 *                      lead before the appointment
 *
 * A confirmation is the driver's own tap, not a position. A step he taps long
 * after the fact reads as late by that long, which is why the summary reports
 * the median delay rather than the average: one tap made the next morning
 * would otherwise speak for the whole month.
 */

/** With no routed plan, the driver is due at the specialist this long before the appointment. */
export const SPECIALIST_LEAD_MINUTES = 30;
export const DEFAULT_GRACE_MINUTES = 5;

export type DriverStepStatus = "on_time" | "late" | "missing" | "upcoming";

export type DriverStep = {
  /** When the driver was due there. */
  dueAt: string;
  /** When he confirmed it; null when he has not. */
  at: string | null;
  /**
   * "missing" is a step never confirmed although its time has passed;
   * "upcoming" is one that is not due yet.
   */
  status: DriverStepStatus;
  /** Minutes past `dueAt`, set only when the step is late. */
  lateMinutes: number | null;
};

export type DriverTripSteps = {
  specialist: DriverStep;
  client: DriverStep;
  /** Where the specialist's due time came from. */
  specialistDueBasis: "plan" | "lead";
};

export type DriverStepSummary = {
  onTime: number;
  late: number;
  missing: number;
  /** Median delay of the late ones, null when none were late. */
  medianLateMinutes: number | null;
};

export type DriverLateness = {
  /** Dispatched trips the two steps were judged on. */
  trips: number;
  specialist: DriverStepSummary;
  client: DriverStepSummary;
};

function judge(dueMs: number, at: string | null, graceMs: number, nowMs: number): DriverStep {
  const dueAt = new Date(dueMs).toISOString();
  const atMs = at ? Date.parse(at) : NaN;
  if (!Number.isFinite(atMs)) {
    return {
      dueAt,
      at: null,
      status: nowMs > dueMs + graceMs ? "missing" : "upcoming",
      lateMinutes: null,
    };
  }
  const late = atMs > dueMs + graceMs;
  return {
    dueAt,
    at,
    status: late ? "late" : "on_time",
    lateMinutes: late ? Math.round((atMs - dueMs) / 60_000) : null,
  };
}

export function driverTripSteps(input: {
  /** The appointment at the client. */
  arrivalAt: string;
  /** The routed plan's time at the specialist, when the order has a plan. */
  plannedSpecialistAt: string | null;
  driverArrivedAt: string | null;
  driverClientArrivedAt: string | null;
  graceMinutes: number;
  nowMs: number;
}): DriverTripSteps | null {
  const clientDueMs = Date.parse(input.arrivalAt);
  if (!Number.isFinite(clientDueMs)) return null;
  const plannedMs = input.plannedSpecialistAt ? Date.parse(input.plannedSpecialistAt) : NaN;
  const hasPlan = Number.isFinite(plannedMs);
  const graceMs = input.graceMinutes * 60_000;
  return {
    specialist: judge(
      hasPlan ? plannedMs : clientDueMs - SPECIALIST_LEAD_MINUTES * 60_000,
      input.driverArrivedAt,
      graceMs,
      input.nowMs,
    ),
    client: judge(clientDueMs, input.driverClientArrivedAt, graceMs, input.nowMs),
    specialistDueBasis: hasPlan ? "plan" : "lead",
  };
}

function summarizeStep(steps: DriverStep[]): DriverStepSummary {
  const delays = steps
    .flatMap((step) => (step.lateMinutes == null ? [] : [step.lateMinutes]))
    .sort((a, b) => a - b);
  const middle = delays.length >> 1;
  return {
    onTime: steps.filter((step) => step.status === "on_time").length,
    late: delays.length,
    missing: steps.filter((step) => step.status === "missing").length,
    medianLateMinutes: !delays.length
      ? null
      : delays.length % 2
        ? delays[middle]!
        : Math.round((delays[middle - 1]! + delays[middle]!) / 2),
  };
}

export function summarizeDriverSteps(trips: DriverTripSteps[]): DriverLateness {
  return {
    trips: trips.length,
    specialist: summarizeStep(trips.map((trip) => trip.specialist)),
    client: summarizeStep(trips.map((trip) => trip.client)),
  };
}
