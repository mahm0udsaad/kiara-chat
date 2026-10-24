/**
 * Why an order is being raised for a Rekaz visit.
 *
 * - `dispatch`: «طلب سائق». The employee is about to send a driver, so the
 *   visit must be one Rekaz says can still be served.
 * - `open`: tapping a «بدون طلب» card to open the visit, for example to set its
 *   district after it happened. Nothing is sent from here, and preview/send
 *   still check Rekaz, so a completed or unconfirmed visit may be opened.
 *
 * Anything unrecognised means `dispatch`, so older app builds keep the
 * stricter behaviour.
 */
export type ReservationOrderIntent = "dispatch" | "open";

export function parseReservationOrderIntent(value: unknown): ReservationOrderIntent {
  return value === "open" ? "open" : "dispatch";
}

/**
 * Whether Rekaz allows a driver for this visit, from the statuses of its
 * same-day bookings. Null means go ahead.
 */
export function rekazDispatchRefusal(
  statuses: Array<string | null | undefined>,
): "RESERVATION_COMPLETED" | "RESERVATION_NOT_CONFIRMED" | null {
  const live = statuses.filter((status) => status !== "Cancelled");
  if (!live.length) return null;
  if (live.every((status) => status === "Done")) return "RESERVATION_COMPLETED";
  if (live.some((status) => status === "Pending")) return "RESERVATION_NOT_CONFIRMED";
  return null;
}
