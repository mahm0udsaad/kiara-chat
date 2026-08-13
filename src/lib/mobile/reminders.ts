import "server-only";

import { normalizePhone } from "@/lib/phone";
import {
  latestReservationFollowUpOf,
  reservationFollowUpsOf,
  type ReservationFollowUpStatus,
} from "@/lib/reservation-follow-up";
import { getReservationsSnapshot } from "@/lib/reservations";

type Snapshot = Awaited<ReturnType<typeof getReservationsSnapshot>>;

let cachedSnapshot: Promise<Snapshot> | null = null;
let cachedSnapshotExpiresAt = 0;

function recentReservationsSnapshot(): Promise<Snapshot> {
  const now = Date.now();
  if (!cachedSnapshot || now >= cachedSnapshotExpiresAt) {
    cachedSnapshotExpiresAt = now + 60_000;
    cachedSnapshot = getReservationsSnapshot().catch(() => null);
  }
  return cachedSnapshot;
}

export type MobileReminderConfirmationStatus =
  | ReservationFollowUpStatus
  | "not_recorded";

export interface MobileReminderConfirmation {
  dayKey: string;
  status: MobileReminderConfirmationStatus;
  remindedAt: string | null;
  updatedAt: string | null;
}

const RIYADH_DAY = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Asia/Riyadh",
});

/**
 * Chooses the appointment the chat should act on: the nearest upcoming Rekaz
 * booking first, falling back to the last persisted reminder when Rekaz is
 * unavailable. Several services on the same day collapse to one decision.
 */
export async function mobileReminderConfirmationFor(input: {
  customerPhone: string;
  metadata: Record<string, unknown> | null | undefined;
}): Promise<MobileReminderConfirmation | null> {
  const followUps = reservationFollowUpsOf(input.metadata);
  const latestStored = latestReservationFollowUpOf(input.metadata);
  const today = RIYADH_DAY.format(new Date());
  const normalizedPhone = normalizePhone(input.customerPhone);
  // The conversation screen refreshes frequently. Rekaz is a shared snapshot,
  // so one short-lived read serves all open chats instead of downloading the
  // same blob on every poll.
  const snapshot = await recentReservationsSnapshot();
  const appointmentDays = [
    ...new Set(
      (snapshot?.reservations ?? [])
        .filter(
          (reservation) =>
            normalizePhone(reservation.customerPhone) === normalizedPhone &&
            reservation.status !== "Cancelled"
        )
        .map((reservation) => reservation.arrivalAt.slice(0, 10))
        .filter((dayKey) => /^\d{4}-\d{2}-\d{2}$/.test(dayKey))
    ),
  ].sort();

  const dayKey =
    appointmentDays.find((candidate) => candidate >= today) ??
    latestStored?.dayKey ??
    appointmentDays.at(-1) ??
    null;
  if (!dayKey) return null;

  const followUp = followUps[dayKey];
  return {
    dayKey,
    status: followUp?.status ?? "not_recorded",
    remindedAt: followUp?.reminded_at ?? null,
    updatedAt: followUp?.updated_at || null,
  };
}
