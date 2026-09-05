import { phoneMatches } from "@/lib/phone";
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
    for (const service of order.approved_services ?? []) {
      if (service.sourceId) ordersBySource.set(service.sourceId, order);
    }
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
    const linkedOrder = ordersBySource.get(reservation.id);
    const key = linkedOrder ? `visit:${linkedOrder.id}` : orderId
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
      arrivalAt: order?.arrival_at ?? span.startsAt,
      endsAt: order?.expected_end_at ?? span.endsAt,
      durationMinutes: order?.duration_minutes ?? span.minutes,
      serviceCount: order?.approved_services?.length ?? group.length,
      customerName: first.customerName || order?.customer_name || "",
      customerPhone: first.customerPhone,
      reservation: first,
      order: order ?? null,
      conversationId: order?.conversation_id ?? null,
      services: order?.approved_services?.length ? order.approved_services.map(s => s.name) : countedServices(group),
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
      endsAt: order.expected_end_at ?? new Date(
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

export type VisitFilter =
  | "all"
  | "today"
  | "needs_driver"
  | "driver_requested"
  | "exception";

/**
 * `needs_driver` is the queue that actually drives the day: a visit with no
 * order yet, or an order with nobody assigned. `driver_requested` is the other
 * side of that queue — a driver is on it, so the question has moved from "who
 * takes this?" to "where has it got to?", which is exactly the set the
 * follow-up button on the card opens. `exception` is anything that failed or
 * stalled mid-dispatch.
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
    case "driver_requested":
      return Boolean(visit.order?.driver_id);
    case "exception":
      return (
        visit.order?.status === "failed" ||
        visit.order?.dispatch_state === "failed" ||
        visit.order?.dispatch_state === "uncertain" ||
        visit.order?.dispatch_state === "processing"
      );
  }
}

/**
 * Free-text match for the agenda's search box.
 *
 * Deliberately wider than the customer: an employee hunting for a visit knows
 * it by whoever is on it just as often as by who booked it, so the assigned
 * specialist and driver are searchable too. The phone rules come from
 * {@link phoneMatches}, so `0502376231` and `+966502376231` behave the same
 * here as they do in the chat list.
 */
export function visitMatchesSearch(
  visit: CalendarVisit,
  rawQuery: string,
): boolean {
  const query = rawQuery.trim().toLocaleLowerCase("ar");
  if (!query) return true;
  const haystack = [
    visit.customerName,
    visit.order?.customer_name,
    visit.order?.specialist_name,
    visit.order?.driver_name,
    visit.location,
    ...visit.providers,
    ...visit.services,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("ar");
  return (
    haystack.includes(query) ||
    phoneMatches(visit.customerPhone, rawQuery) ||
    phoneMatches(visit.order?.customer_phone, rawQuery)
  );
}

/* ------------------------------------------------------------------ *
 * The day grid: one column per specialist, one row per hour.
 *
 * The agenda merges a customer's services into one card, which is right for
 * work done back to back and wrong for work done at once: two specialists on
 * the same customer at 08:00 collapsed onto a single line with room for one
 * assignment. The grid places every service in its own specialist's column
 * instead, the way the salon reads its schedule in Rekaz.
 * ------------------------------------------------------------------ */

/** A booking with no one on it yet still has to appear somewhere. */
export const UNASSIGNED_COLUMN = "__unassigned__";

export type ScheduleColumn = {
  id: string;
  name: string;
  slotCount: number;
  /** Widest overlap in this column; the grid widens it to keep cards legible. */
  maxLanes: number;
};

export type ScheduleSlot = {
  key: string;
  columnId: string;
  /** Minutes from Riyadh midnight, which is what the grid measures in. */
  startMinutes: number;
  endMinutes: number;
  /** Side-by-side placement when one specialist is double-booked. */
  lane: number;
  lanes: number;
  /** The first service of the card; the rest are named in `services`. */
  reservation: RekazReservation;
  /** Every service this card stands for, repeats folded into a count. */
  services: string[];
  serviceCount: number;
  order: OrderSummary | null;
};

export type DaySchedule = {
  columns: ScheduleColumn[];
  slots: ScheduleSlot[];
  /** The hours the grid draws, widened to whole hours around the day's work. */
  startHour: number;
  endHour: number;
};

const clockFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: RIYADH_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Minutes from Riyadh midnight — never the device's, which may be anywhere. */
export function riyadhMinutesOf(iso: string): number {
  const [hour, minute] = clockFormatter.format(new Date(iso)).split(":");
  return Number(hour) * 60 + Number(minute);
}

const isCancelled = (reservation: RekazReservation) =>
  reservation.status === "Cancelled";

/**
 * One specialist, one customer, one card.
 *
 * A customer's services under the same specialist are one stretch of work, and
 * Rekaz lists them as separate reservations minutes apart. Placed individually
 * they overlap, each takes a lane, and the column splits four ways into
 * slivers too narrow to read — which is how bookings went missing on the grid.
 * Runs that touch or overlap are merged into the span they really occupy. Work
 * by a DIFFERENT specialist is never merged in: keeping that apart is the
 * whole point of the grid.
 */
function mergeRuns(slots: ScheduleSlot[]): ScheduleSlot[] {
  const byCustomer = new Map<string, ScheduleSlot[]>();
  for (const slot of slots) {
    const key =
      digitsOf(slot.reservation.customerPhone) || slot.reservation.customerName;
    const bucket = byCustomer.get(key) ?? [];
    bucket.push(slot);
    byCustomer.set(key, bucket);
  }

  const merged: ScheduleSlot[] = [];
  for (const bucket of byCustomer.values()) {
    let run: ScheduleSlot[] = [];
    const flush = () => {
      if (!run.length) return;
      const first = run[0]!;
      const counts = new Map<string, number>();
      for (const slot of run) {
        for (const name of slot.services) {
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
      }
      merged.push({
        ...first,
        endMinutes: Math.max(...run.map((slot) => slot.endMinutes)),
        serviceCount: run.reduce((total, slot) => total + slot.serviceCount, 0),
        services: [...counts].map(([name, count]) =>
          count > 1 ? `${name} ×${count}` : name,
        ),
        // Whichever of the run already has an order: a merged card still
        // opens the visit it belongs to.
        order: run.find((slot) => slot.order)?.order ?? null,
      });
      run = [];
    };

    for (const slot of [...bucket].sort((a, b) => a.startMinutes - b.startMinutes)) {
      const runEnd = run.length
        ? Math.max(...run.map((item) => item.endMinutes))
        : null;
      // Touching counts as continuous: 10:00-10:20 then 10:20-10:40 is one
      // sitting, not two cards stacked on the same minute.
      if (runEnd !== null && slot.startMinutes > runEnd) flush();
      run.push(slot);
    }
    flush();
  }
  return merged;
}

/**
 * Lay overlapping slots side by side inside one column.
 *
 * A specialist booked twice at 17:00 is either a data entry the salon wants to
 * see or a genuine double-booking she has to resolve. Stacking the two cards
 * would hide one of them; splitting the column width shows both.
 */
function assignLanes(slots: ScheduleSlot[]): void {
  const byStart = [...slots].sort((a, b) => a.startMinutes - b.startMinutes);
  let cluster: ScheduleSlot[] = [];
  let clusterEnd = -1;

  const close = () => {
    for (const slot of cluster) slot.lanes = cluster.length;
    cluster = [];
    clusterEnd = -1;
  };

  for (const slot of byStart) {
    if (cluster.length && slot.startMinutes >= clusterEnd) close();
    slot.lane = cluster.length;
    cluster.push(slot);
    clusterEnd = Math.max(clusterEnd, slot.endMinutes);
  }
  if (cluster.length) close();
}

export function buildDaySchedule(
  reservations: RekazReservation[],
  orders: OrderSummary[],
  dayKey: string,
): DaySchedule {
  const ordersBySource = new Map<string, OrderSummary>();
  for (const order of orders) {
    if (order.rekaz_source_id) ordersBySource.set(order.rekaz_source_id, order);
    for (const service of order.approved_services ?? []) {
      if (service.sourceId) ordersBySource.set(service.sourceId, order);
    }
  }

  const byColumn = new Map<string, ScheduleSlot[]>();
  const names = new Map<string, string>();

  for (const reservation of reservations) {
    if (isCancelled(reservation)) continue;
    if (dayKeyOf(reservation.arrivalAt) !== dayKey) continue;

    const start = riyadhMinutesOf(reservation.arrivalAt);
    const end = start + Math.max(reservation.durationMinutes || 0, 15);
    const order =
      ordersBySource.get(reservation.id) ??
      orders.find(
        (candidate) =>
          !candidate.rekaz_source_id &&
          digitsOf(candidate.customer_phone) ===
            digitsOf(reservation.customerPhone) &&
          dayKeyOf(candidate.arrival_at) === dayKey,
      ) ??
      null;

    // A service Rekaz lists under two providers is worked by both, so it is
    // drawn in both columns rather than arbitrarily assigned to one.
    const providers = reservation.providers.map((p) => p.trim()).filter(Boolean);
    const columns = providers.length ? providers : [UNASSIGNED_COLUMN];
    for (const columnId of columns) {
      names.set(columnId, columnId === UNASSIGNED_COLUMN ? "بدون مقدمة" : columnId);
      const bucket = byColumn.get(columnId) ?? [];
      bucket.push({
        key: `${reservation.id}:${columnId}`,
        columnId,
        startMinutes: start,
        endMinutes: end,
        lane: 0,
        lanes: 1,
        reservation,
        services: [reservation.service?.trim()].filter(Boolean) as string[],
        serviceCount: 1,
        order,
      });
      byColumn.set(columnId, bucket);
    }
  }

  const slots: ScheduleSlot[] = [];
  for (const [columnId, bucket] of byColumn) {
    const cards = mergeRuns(bucket);
    assignLanes(cards);
    byColumn.set(columnId, cards);
    slots.push(...cards);
  }

  const columns = [...byColumn.entries()]
    .map(([id, bucket]) => ({
      id,
      name: names.get(id) ?? id,
      slotCount: bucket.length,
      maxLanes: bucket.reduce((widest, slot) => Math.max(widest, slot.lanes), 1),
    }))
    .sort((a, b) => {
      // The unnamed column is where the day's unassigned work sits; it belongs
      // at the end, not sorted in among the specialists by its label.
      if (a.id === UNASSIGNED_COLUMN) return 1;
      if (b.id === UNASSIGNED_COLUMN) return -1;
      return b.slotCount - a.slotCount || a.name.localeCompare(b.name, "ar");
    });

  // Whole hours around the work, with a floor so an empty or one-booking day
  // still looks like a day rather than a single stripe.
  const starts = slots.map((slot) => slot.startMinutes);
  const ends = slots.map((slot) => slot.endMinutes);
  const startHour = slots.length ? Math.floor(Math.min(...starts) / 60) : 10;
  const endHour = slots.length
    ? Math.min(24, Math.ceil(Math.max(...ends) / 60))
    : 22;

  return { columns, slots, startHour, endHour: Math.max(endHour, startHour + 4) };
}
