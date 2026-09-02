/**
 * How long each leg of a visit actually took.
 *
 * The step machine already stamps every confirmation; nobody had ever
 * subtracted them. The salon could see that a visit finished but not that the
 * specialist waited fifty minutes for her ride, or that the driver took an hour
 * to come back for her — the two things that decide whether the next booking
 * can be accepted.
 *
 * A leg is only measured when both of its ends were confirmed. A missing stamp
 * means the step was skipped or is still pending, and inventing a duration for
 * it would quietly drag every average toward whatever the visit's own gaps
 * happened to be.
 */
import type { FieldOrderProgressState } from "@/lib/types";

export type FieldLegKey =
  | "dispatch_to_confirm"
  | "confirm_to_pickup"
  | "pickup_to_service"
  | "service"
  | "service_to_return";

export interface FieldLeg {
  key: FieldLegKey;
  /** Arabic, for the order sheet and the report — both are read in Arabic. */
  label: string;
  minutes: number;
}

/**
 * The legs, in the order they happen.
 *
 * `service` is the visit itself rather than a delay, and is kept alongside the
 * others deliberately: an average service that runs well over its booked
 * duration is the same operational problem as a late driver, and reading them
 * apart would hide that the day is over-running for an innocent reason.
 */
const LEGS: {
  key: FieldLegKey;
  label: string;
  from: (p: FieldOrderProgressState, sentAt: string | null) => string | null;
  to: (p: FieldOrderProgressState) => string | null;
}[] = [
  {
    key: "dispatch_to_confirm",
    label: "من الإسناد حتى تأكيد السائق",
    from: (_p, sentAt) => sentAt,
    to: (p) => p.driverConfirmedAt,
  },
  {
    key: "confirm_to_pickup",
    label: "من تأكيد السائق حتى ركوب الأخصائية",
    from: (p) => p.driverConfirmedAt,
    to: (p) => p.specialistPickupAt,
  },
  {
    key: "pickup_to_service",
    label: "من الركوب حتى بدء الخدمة",
    from: (p) => p.specialistPickupAt,
    to: (p) => p.serviceStartedAt,
  },
  {
    key: "service",
    label: "مدة الخدمة الفعلية",
    from: (p) => p.serviceStartedAt,
    to: (p) => p.completedAt,
  },
  {
    key: "service_to_return",
    label: "من انتهاء الخدمة حتى عودة السائق",
    from: (p) => p.completedAt,
    to: (p) => p.driverReturnedAt,
  },
];

const minutesBetween = (from: string, to: string): number | null => {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const minutes = Math.round((end - start) / 60_000);
  // A negative leg means the stamps are out of order — a clock skew or a step
  // confirmed late. Dropping it is honest; clamping it to zero would report a
  // wait that never happened as instantaneous.
  return minutes >= 0 ? minutes : null;
};

/** Every leg of one visit that both of its stamps can account for. */
export function fieldLegsOf(
  progress: FieldOrderProgressState | null | undefined,
  sentAt: string | null,
): FieldLeg[] {
  if (!progress) return [];
  const legs: FieldLeg[] = [];
  for (const leg of LEGS) {
    const from = leg.from(progress, sentAt);
    const to = leg.to(progress);
    if (!from || !to) continue;
    const minutes = minutesBetween(from, to);
    if (minutes === null) continue;
    legs.push({ key: leg.key, label: leg.label, minutes });
  }
  return legs;
}

export interface FieldLegAverage {
  key: FieldLegKey;
  label: string;
  /** Visits that confirmed both ends of this leg. */
  sampleCount: number;
  averageMinutes: number;
  slowestMinutes: number;
}

/**
 * Averages across many visits.
 *
 * Each leg counts its own sample: a day where three drivers never confirmed
 * their return still has a trustworthy pickup average, and saying so with
 * `sampleCount` is what stops one straggler reading as the whole week.
 */
export function averageFieldLegs(visits: FieldLeg[][]): FieldLegAverage[] {
  return LEGS.map(({ key, label }) => {
    const samples = visits
      .flat()
      .filter((leg) => leg.key === key)
      .map((leg) => leg.minutes);
    if (!samples.length) {
      return { key, label, sampleCount: 0, averageMinutes: 0, slowestMinutes: 0 };
    }
    const total = samples.reduce((sum, value) => sum + value, 0);
    return {
      key,
      label,
      sampleCount: samples.length,
      averageMinutes: Math.round(total / samples.length),
      slowestMinutes: Math.max(...samples),
    };
  }).filter((average) => average.sampleCount > 0);
}
