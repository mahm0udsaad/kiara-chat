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
  durationMinutes: number;
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

  // Rekaz can list a customer's several services as separate reservations that
  // are really one visit. Group them so the card shows one arrival with its
  // services listed, the way the salon talks about it.
  const grouped = new Map<string, RekazReservation[]>();
  for (const reservation of reservations) {
    const key = `${digitsOf(reservation.customerPhone)}|${reservation.arrivalAt}`;
    const bucket = grouped.get(key);
    if (bucket) bucket.push(reservation);
    else grouped.set(key, [reservation]);
  }

  for (const [key, group] of grouped) {
    const first = group[0]!;
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
      arrivalAt: first.arrivalAt,
      durationMinutes: group.reduce(
        (total, item) => total + (item.durationMinutes || 0),
        0,
      ),
      customerName: first.customerName || order?.customer_name || "",
      customerPhone: first.customerPhone,
      reservation: first,
      order: order ?? null,
      conversationId: order?.conversation_id ?? null,
      services: group.map((item) => item.service).filter(Boolean),
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
      durationMinutes: order.duration_minutes,
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
