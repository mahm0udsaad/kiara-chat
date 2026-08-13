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

export interface ReservationFollowUpTarget extends ReservationFollowUp {
  dayKey: string;
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

export const MAX_RESERVATION_REMINDER_LENGTH = 3000;

/** Build the default WhatsApp copy that staff can edit before confirming. */
export function reservationReminderMessage(input: {
  customerName: unknown;
  arrivalAt: unknown;
  services: unknown;
}): string | null {
  const customerName = String(input.customerName ?? "").trim().slice(0, 80);
  const arrival = new Date(String(input.arrivalAt ?? ""));
  const services = Array.isArray(input.services)
    ? input.services
        .map((service) => String(service).trim())
        .filter(Boolean)
        .slice(0, 10)
    : [];
  if (Number.isNaN(arrival.getTime()) || !services.length) return null;

  const day = new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Riyadh",
  }).format(arrival);
  const time = new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Riyadh",
  }).format(arrival);

  return [
    `مرحبًا ${customerName || "عميلتنا"}،`,
    `نذكّرك بموعدك ${day} الساعة ${time} لخدمة ${services.join("، ")}.`,
    "فضلاً أكدي حضورك، أو أخبرينا الآن إذا رغبتِ بإلغاء الحجز قبل انطلاق السائق.",
  ].join("\n");
}

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

/** Most recently updated appointment follow-up stored on a conversation. */
export function latestReservationFollowUpOf(
  metadata: Record<string, unknown> | null | undefined
): ReservationFollowUpTarget | null {
  const entries = Object.entries(reservationFollowUpsOf(metadata));
  if (!entries.length) return null;
  entries.sort(([dayA, followUpA], [dayB, followUpB]) => {
    const updatedA = Date.parse(followUpA.updated_at) || Date.parse(`${dayA}T00:00:00Z`);
    const updatedB = Date.parse(followUpB.updated_at) || Date.parse(`${dayB}T00:00:00Z`);
    return updatedB - updatedA;
  });
  const [dayKey, followUp] = entries[0]!;
  return { dayKey, ...followUp };
}
