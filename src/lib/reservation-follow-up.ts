import { normalizePhone } from "@/lib/phone";

export type ReservationFollowUpStatus =
  | "awaiting_reply"
  | "confirmed"
  | "cancelled";

export interface ReservationFollowUp {
  status: ReservationFollowUpStatus;
  reminded_at: string | null;
  updated_at: string;
  updated_by: string | null;
}

export type ReservationFollowUpMap = Record<string, ReservationFollowUp>;

export const RESERVATION_FOLLOW_UP_LABEL: Record<
  ReservationFollowUpStatus,
  string
> = {
  awaiting_reply: "بانتظار رد العميلة",
  confirmed: "أكدت الحضور",
  cancelled: "العميلة ألغت",
};

export function isReservationFollowUpStatus(
  value: unknown
): value is ReservationFollowUpStatus {
  return (
    value === "awaiting_reply" || value === "confirmed" || value === "cancelled"
  );
}

/** The visit groups every service for one customer on one Riyadh calendar day. */
export function reservationDayKey(arrivalAt: string): string {
  return arrivalAt.slice(0, 10);
}

/** Stable UI/read-model key. The stored metadata only needs the day portion. */
export function reservationFollowUpKey(phone: string, arrivalAt: string): string {
  return `${normalizePhone(phone)}|${reservationDayKey(arrivalAt)}`;
}

export function reservationFollowUpsOf(
  metadata: Record<string, unknown> | null | undefined
): ReservationFollowUpMap {
  const raw = metadata?.reservation_follow_ups;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

  const parsed: ReservationFollowUpMap = {};
  for (const [day, value] of Object.entries(raw)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const entry = value as Record<string, unknown>;
    if (!isReservationFollowUpStatus(entry.status)) continue;
    parsed[day] = {
      status: entry.status,
      reminded_at:
        typeof entry.reminded_at === "string" ? entry.reminded_at : null,
      updated_at:
        typeof entry.updated_at === "string" ? entry.updated_at : "",
      updated_by:
        typeof entry.updated_by === "string" ? entry.updated_by : null,
    };
  }
  return parsed;
}
