import type { OrderSummary, RekazReservation } from "@/types/api";

/**
 * One row on the calendar. A Rekaz booking and the local operational order
 * that serves it are the same visit and must render as one card — showing
 * both separately is what made the old screen look like double the work.
 */
export type CalendarVisit = {
  /** Stable across a refetch so the agenda does not remount rows. */
  key: string;
  arrivalAt: string;
  /** When the last service of the visit ends — arrival plus the real span. */
  endsAt: string;
  /**
   * Arrival to end, gaps included. Several services booked back to back are
   * one stay, and the span is how long the customer is actually with us —
   * summing the services would under-report the wait between them.
   */
  durationMinutes: number;
  /** More than one service was booked under the same Rekaz order. */
  serviceCount: number;
  customerName: string;
  customerPhone: string;
  /** Present when Rekaz knows about this visit. */
  reservation: RekazReservation | null;
  /** Present once an operational order exists. */
  order: OrderSummary | null;
  conversationId: string | null;
  services: string[];
  providers: string[];
  location: string;
  amount: number;
};

/** `YYYY-MM-DD` in the salon's own timezone, not the device's. */
export const RIYADH_TZ = "Asia/Riyadh";

const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: RIYADH_TZ,
});

export function dayKeyOf(iso: string | Date): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  return dayKeyFormatter.format(date);
}

/** `offset` days from today, as a Riyadh day key. */
export function dayKeyFromToday(offset: number, now = new Date()): string {
  const base = new Date(`${dayKeyOf(now)}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + offset);
  return base.toISOString().slice(0, 10);
}

export function addDays(dayKey: string, days: number): string {
  const base = new Date(`${dayKey}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

const digitsOf = (phone: string) => phone.replace(/\D/g, "");

/**
 * Arrival of the first service to the end of the last, in one pass. The span
 * is what the day is actually planned around: the driver's return and the next
 * customer's slot both hang off when she leaves, not off how many minutes of
 * treatment were sold.
 */
function visitSpan(group: RekazReservation[]): {
  startsAt: string;
  endsAt: string;
  minutes: number;
} {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const item of group) {
    const from = new Date(item.arrivalAt).getTime();
    if (!Number.isFinite(from)) continue;
    start = Math.min(start, from);
    end = Math.max(end, from + Math.max(item.durationMinutes || 0, 0) * 60_000);
  }
  if (!Number.isFinite(start)) {
    const fallback = group[0]?.arrivalAt ?? new Date().toISOString();
    return { startsAt: fallback, endsAt: fallback, minutes: 0 };
  }
  return {
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(end).toISOString(),
    minutes: Math.max(0, Math.round((end - start) / 60_000)),
  };
}

/**
 * Service names for the card, the repeats folded into a count. Two hands and
 * two feet come back from Rekaz as the same name twice; listing it twice reads
 * like a duplicate row rather than a quantity.
 */
function countedServices(group: RekazReservation[]): string[] {
  const counts = new Map<string, number>();
  for (const item of group) {
    const name = item.service?.trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + Math.max(item.quantity || 1, 1));
  }
  return [...counts].map(([name, count]) =>
    count > 1 ? `${name} ×${count}` : name,
  );
}

/**
 * Pair each Rekaz reservation with its operational order.
 *
 * Preferred key is `order.rekaz_source_id`, written when the order was raised
 * from the calendar. Orders created before that link existed fall back to
 * phone-plus-day, which is a guess and is deliberately confined to this one
 * branch: it cannot tell two same-day bookings for one customer apart.
 */
export function mergeVisits(
  reservations: RekazReservation[],
  orders: OrderSummary[],
): CalendarVisit[] {
  const ordersBySource = new Map<string, OrderSummary>();
  for (const order of orders) {
    if (order.rekaz_source_id) ordersBySource.set(order.rekaz_source_id, order);
  }

  const claimed = new Set<string>();
  const visits: CalendarVisit[] = [];

  // Rekaz lists a customer's several services as separate reservations that
  // are really one visit, and it already says which: services booked together
  // share one Rekaz order id. Grouping on that keeps a back-to-back pair —
  // 11:00 for 30 minutes, then 11:40 for 40 — on one card, which matching on
  // the arrival time alone could never do. Reservations with no order id fall
  // back to phone-plus-arrival.
  const grouped = new Map<string, RekazReservation[]>();
  for (const reservation of reservations) {
    const orderId = reservation.order?.id?.trim();
    // The day is part of the key even for an order id, so a group can never
    // straddle two days and disappear from one of them in the agenda.
    const key = orderId
      ? `order:${dayKeyOf(reservation.arrivalAt)}|${orderId}`
      : `slot:${digitsOf(reservation.customerPhone)}|${reservation.arrivalAt}`;
    const bucket = grouped.get(key);
    if (bucket) bucket.push(reservation);
    else grouped.set(key, [reservation]);
  }

  for (const [key, unordered] of grouped) {
    const group = [...unordered].sort((a, b) =>
      a.arrivalAt.localeCompare(b.arrivalAt),
    );
    const first = group[0]!;
    const span = visitSpan(group);
    let order = group
      .map((item) => ordersBySource.get(item.id))
      .find(Boolean) as OrderSummary | undefined;

    if (!order) {
      order = orders.find(
        (candidate) =>
          !candidate.rekaz_source_id &&
          !claimed.has(candidate.id) &&
          digitsOf(candidate.customer_phone) === digitsOf(first.customerPhone) &&
          dayKeyOf(candidate.arrival_at) === dayKeyOf(first.arrivalAt),
      );
    }
    if (order) claimed.add(order.id);

    visits.push({
      key: `rekaz:${key}`,
      arrivalAt: span.startsAt,
      endsAt: span.endsAt,
      durationMinutes: span.minutes,
      serviceCount: group.length,
      customerName: first.customerName || order?.customer_name || "",
      customerPhone: first.customerPhone,
      reservation: first,
      order: order ?? null,
      conversationId: order?.conversation_id ?? null,
      services: countedServices(group),
      providers: [...new Set(group.flatMap((item) => item.providers))],
      location: first.location?.label?.trim() || order?.customer_location || "",
      amount: group.reduce((total, item) => total + (item.amount || 0), 0),
    });
  }

  // Orders with no Rekaz counterpart are still real work — a booking taken
  // over WhatsApp never reaches Rekaz at all.
  for (const order of orders) {
    if (claimed.has(order.id)) continue;
    visits.push({
      key: `order:${order.id}`,
      arrivalAt: order.arrival_at,
      endsAt: new Date(
        new Date(order.arrival_at).getTime() + order.duration_minutes * 60_000,
      ).toISOString(),
      durationMinutes: order.duration_minutes,
      serviceCount: 0,
      customerName: order.customer_name ?? "",
      customerPhone: order.customer_phone,
      reservation: null,
      order,
      conversationId: order.conversation_id,
      services: [],
      providers: [order.specialist_name].filter(Boolean) as string[],
      location: order.customer_location,
      amount: order.price ?? 0,
    });
  }

  return visits.sort((a, b) => a.arrivalAt.localeCompare(b.arrivalAt));
}

export type VisitFilter = "all" | "today" | "needs_driver" | "exception";

/**
 * `needs_driver` is the queue that actually drives the day: a visit with no
 * order yet, or an order with nobody assigned. `exception` is anything that
 * failed or stalled mid-dispatch.
 */
export function visitMatchesFilter(
  visit: CalendarVisit,
  filter: VisitFilter,
  todayKey: string,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "today":
      return dayKeyOf(visit.arrivalAt) === todayKey;
    case "needs_driver":
      return !visit.order || !visit.order.driver_id || !visit.order.specialist_id;
    case "exception":
      return (
        visit.order?.status === "failed" ||
        visit.order?.dispatch_state === "failed" ||
        visit.order?.dispatch_state === "uncertain" ||
        visit.order?.dispatch_state === "processing"
      );
  }
}
