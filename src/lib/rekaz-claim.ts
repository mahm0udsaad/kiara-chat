/**
 * Which existing order may give up its claim on a Rekaz booking.
 *
 * Rekaz reuses a reservation when a booking is moved — a package session
 * rescheduled from 4 October to the 20th keeps its number — so the order raised
 * for the old day still holds the link when the employee raises the new one.
 *
 * - A cancelled order describes work that is not happening: it gives up the
 *   link and its frozen service list entirely.
 * - A sent order on an earlier Riyadh day is a trip that already happened. Its
 *   driver, specialist, cost and services are history and stay exactly as they
 *   were; only the pointer back to the reservation is released, because that
 *   reservation now describes a different visit.
 * - Anything else is live: a pending order follows the booking (handled by the
 *   caller), and a sent order for today or later is a driver and specialist
 *   holding a time, which only the employee can decide to move.
 */
export type RekazClaimRelease = "cancelled" | "past" | null;

const RIYADH_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Riyadh",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function riyadhDay(at: string | number | Date): string {
  return RIYADH_DAY.format(new Date(at));
}

export function claimRelease(
  order: { status: string | null; dispatch_state?: string | null; arrival_at: string | null },
  now: Date = new Date(),
): RekazClaimRelease {
  if (order.status === "cancelled" || order.dispatch_state === "cancelled") return "cancelled";
  if (order.status !== "sent" || !order.arrival_at) return null;
  const arrival = Date.parse(order.arrival_at);
  if (!Number.isFinite(arrival)) return null;
  return riyadhDay(arrival) < riyadhDay(now) ? "past" : null;
}
