/**
 * How long each leg of a visit took — the phone's copy of the server's
 * `src/lib/field-timings.ts`.
 *
 * Duplicated rather than shared because the two projects do not share a module
 * graph (see `lib/format.ts`, which is parallel for the same reason). The leg
 * keys and Arabic labels must stay identical to the server's, or the same visit
 * reads differently in the app than in the owner's report.
 */
import type { FieldOrderProgress } from "@/types/api";

export type FieldLegKey =
  | "dispatch_to_confirm"
  | "confirm_to_pickup"
  | "pickup_to_service"
  | "service"
  | "service_to_return";

export interface FieldLeg {
  key: FieldLegKey;
  label: string;
  minutes: number;
}

const LEGS: {
  key: FieldLegKey;
  label: string;
  from: (p: FieldOrderProgress, sentAt: string | null) => string | null;
  to: (p: FieldOrderProgress) => string | null;
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

/**
 * Every leg both of whose stamps exist. A missing one means the step was
 * skipped or is still pending; inventing a duration for it would report a wait
 * that never happened.
 */
export function fieldLegsOf(
  progress: FieldOrderProgress | null | undefined,
  sentAt: string | null,
): FieldLeg[] {
  if (!progress) return [];
  const legs: FieldLeg[] = [];
  for (const leg of LEGS) {
    const from = leg.from(progress, sentAt);
    const to = leg.to(progress);
    if (!from || !to) continue;
    const start = Date.parse(from);
    const end = Date.parse(to);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const minutes = Math.round((end - start) / 60_000);
    // Out-of-order stamps (clock skew, a step confirmed late) are dropped
    // rather than clamped to zero.
    if (minutes < 0) continue;
    legs.push({ key: leg.key, label: leg.label, minutes });
  }
  return legs;
}

/** Minutes until that stops being legible, then hours. */
export function legDurationLabel(minutes: number): string {
  if (minutes >= 120) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} س ${rest} د` : `${hours} س`;
  }
  return `${minutes} د`;
}
