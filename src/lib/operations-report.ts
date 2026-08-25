import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import type { RekazReservation } from "@/lib/reservations";

export const OPERATIONS_TIME_ZONE = "Asia/Riyadh";

export type OperationsRole = "specialist" | "driver";
export type OperationsSource = "rekaz" | "whatsapp";

export type OperationsPerson = {
  id: string;
  name: string;
  isActive: boolean;
  source: "roster" | "rekaz";
  assignedCount: number;
  completedCount: number;
  scheduledMinutes: number;
  completedMinutes: number;
};

export type OperationsEvent = {
  id: string;
  visitKey: string;
  source: OperationsSource;
  sourceLabel: "حجز ركاز" | "طلب واتساب";
  orderId: string | null;
  personIds: string[];
  arrivalAt: string;
  endsAt: string;
  durationMinutes: number;
  customerName: string;
  customerPhone: string;
  service: string;
  status: string;
  completed: boolean;
  completedAt: string | null;
};

export type OperationsReport = {
  from: string;
  to: string;
  startTime: string;
  endTime: string;
  timeZone: typeof OPERATIONS_TIME_ZONE;
  generatedAt: string;
  people: Record<OperationsRole, OperationsPerson[]>;
  events: Record<OperationsRole, OperationsEvent[]>;
};

type RosterRow = { id: string; full_name: string; is_active: boolean };
type OrderRow = {
  id: string;
  specialist_id: string | null;
  driver_id: string | null;
  arrival_at: string;
  duration_minutes: number;
  customer_phone: string;
  rekaz_source_id: string | null;
};
type ProgressRow = { order_id: string; completed_at: string | null };
type ReservationRow = {
  source_id: string;
  status: string;
  payload: RekazReservation;
};

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const TIME_KEY = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MAX_RANGE_DAYS = 31;

export type OperationsReportInput = {
  from: string;
  to: string;
  startTime?: string;
  endTime?: string;
};

export class OperationsReportInputError extends Error {}

function boundary(day: string, time: string): string {
  return `${day}T${time}:00+03:00`;
}

export function validateOperationsReportInput(input: OperationsReportInput) {
  const startTime = input.startTime ?? "08:00";
  const endTime = input.endTime ?? "22:00";
  if (!DAY_KEY.test(input.from) || !DAY_KEY.test(input.to)) {
    throw new OperationsReportInputError("from and to must be YYYY-MM-DD");
  }
  if (!TIME_KEY.test(startTime) || !TIME_KEY.test(endTime) || endTime <= startTime) {
    throw new OperationsReportInputError("startTime and endTime must be a valid increasing range");
  }
  const fromMs = new Date(boundary(input.from, "00:00")).getTime();
  const toMs = new Date(boundary(input.to, "23:59")).getTime();
  if (
    !Number.isFinite(fromMs) ||
    !Number.isFinite(toMs) ||
    toMs < fromMs ||
    toMs - fromMs > MAX_RANGE_DAYS * 24 * 60 * 60 * 1_000
  ) {
    throw new OperationsReportInputError("The report range is invalid or exceeds 31 days");
  }
  return { from: input.from, to: input.to, startTime, endTime };
}

const normalizeName = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ar");
const virtualId = (name: string) => `rekaz:${encodeURIComponent(normalizeName(name))}`;

function dateKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: OPERATIONS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function minuteOfDay(iso: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: OPERATIONS_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

const timeToMinutes = (time: string) => {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
};

function overlapsWindow(arrivalAt: string, durationMinutes: number, start: number, end: number) {
  const eventStart = minuteOfDay(arrivalAt);
  const eventEnd = eventStart + Math.max(durationMinutes, 1);
  return eventStart < end && eventEnd > start;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function visitKeyOf(reservation: RekazReservation): string {
  const order = reservation.order?.id?.trim();
  return order
    ? `rekaz:${dateKey(reservation.arrivalAt)}:${order}`
    : `rekaz:${reservation.id}`;
}

function buildPeople(
  roster: RosterRow[],
  extraNames: string[],
): { people: OperationsPerson[]; idByName: Map<string, string> } {
  const idByName = new Map<string, string>();
  const people: OperationsPerson[] = roster.map((person) => {
    idByName.set(normalizeName(person.full_name), person.id);
    return {
      id: person.id,
      name: person.full_name,
      isActive: person.is_active,
      source: "roster" as const,
      assignedCount: 0,
      completedCount: 0,
      scheduledMinutes: 0,
      completedMinutes: 0,
    };
  });
  for (const name of extraNames) {
    const normalized = normalizeName(name);
    if (!normalized || idByName.has(normalized)) continue;
    const id = virtualId(name);
    idByName.set(normalized, id);
    people.push({
      id,
      name: name.trim(),
      isActive: true,
      source: "rekaz",
      assignedCount: 0,
      completedCount: 0,
      scheduledMinutes: 0,
      completedMinutes: 0,
    });
  }
  return { people, idByName };
}

function addMetrics(people: OperationsPerson[], events: OperationsEvent[]) {
  const byId = new Map(people.map((person) => [person.id, person]));
  const assigned = new Map<string, Set<string>>();
  const completed = new Map<string, Set<string>>();
  for (const event of events) {
    for (const personId of event.personIds) {
      const person = byId.get(personId);
      if (!person) continue;
      const assignedVisits = assigned.get(personId) ?? new Set<string>();
      assignedVisits.add(event.visitKey);
      assigned.set(personId, assignedVisits);
      person.scheduledMinutes += event.durationMinutes;
      if (event.completed) {
        const completedVisits = completed.get(personId) ?? new Set<string>();
        completedVisits.add(event.visitKey);
        completed.set(personId, completedVisits);
        person.completedMinutes += event.durationMinutes;
      }
    }
  }
  for (const person of people) {
    person.assignedCount = assigned.get(person.id)?.size ?? 0;
    person.completedCount = completed.get(person.id)?.size ?? 0;
  }
  people.sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    if (a.assignedCount !== b.assignedCount) return b.assignedCount - a.assignedCount;
    return a.name.localeCompare(b.name, "ar");
  });
}

export async function getOperationsReport(raw: OperationsReportInput): Promise<OperationsReport> {
  const input = validateOperationsReportInput(raw);
  const admin = getAdminSupabaseClient();
  const rangeStart = boundary(input.from, "00:00");
  const rangeEnd = boundary(input.to, "23:59");
  const [reservationsResult, ordersResult, progressResult, specialistsResult, driversResult] =
    await Promise.all([
      admin
        .from("rekaz_reservations")
        .select("source_id, status, payload")
        .eq("restaurant_id", KIARA_RESTAURANT_ID)
        .is("removed_at", null)
        .neq("status", "Cancelled")
        .gte("arrival_at", rangeStart)
        .lte("arrival_at", rangeEnd),
      admin
        .from("driver_orders")
        .select("id, specialist_id, driver_id, arrival_at, duration_minutes, customer_phone, rekaz_source_id")
        .eq("restaurant_id", KIARA_RESTAURANT_ID)
        .gte("arrival_at", rangeStart)
        .lte("arrival_at", rangeEnd),
      admin
        .from("field_order_progress")
        .select("order_id, completed_at")
        .eq("restaurant_id", KIARA_RESTAURANT_ID),
      admin
        .from("specialists")
        .select("id, full_name, is_active")
        .eq("restaurant_id", KIARA_RESTAURANT_ID),
      admin
        .from("drivers")
        .select("id, full_name, is_active")
        .eq("restaurant_id", KIARA_RESTAURANT_ID),
    ]);

  for (const result of [reservationsResult, ordersResult, progressResult, specialistsResult, driversResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const reservations = (reservationsResult.data ?? []) as unknown as ReservationRow[];
  const orders = (ordersResult.data ?? []) as unknown as OrderRow[];
  const progress = (progressResult.data ?? []) as unknown as ProgressRow[];
  const specialists = (specialistsResult.data ?? []) as unknown as RosterRow[];
  const drivers = (driversResult.data ?? []) as unknown as RosterRow[];
  const startMinute = timeToMinutes(input.startTime);
  const endMinute = timeToMinutes(input.endTime);

  const specialistNames = unique(
    reservations.flatMap((row) => row.payload?.providers ?? []).filter(Boolean),
  );
  const specialistPeople = buildPeople(specialists, specialistNames);
  const driverPeople = buildPeople(drivers, []);
  const orderBySource = new Map<string, OrderRow>();
  for (const order of orders) if (order.rekaz_source_id) orderBySource.set(order.rekaz_source_id, order);
  const completedAtByOrder = new Map(progress.map((row) => [row.order_id, row.completed_at]));
  const claimedOrders = new Set<string>();
  const specialistEvents: OperationsEvent[] = [];
  const reservationsByVisit = new Map<string, ReservationRow[]>();

  for (const row of reservations) {
    if (!row.payload?.arrivalAt || !overlapsWindow(row.payload.arrivalAt, row.payload.durationMinutes, startMinute, endMinute)) continue;
    const key = visitKeyOf(row.payload);
    const group = reservationsByVisit.get(key) ?? [];
    group.push(row);
    reservationsByVisit.set(key, group);
  }

  for (const [visitKey, group] of reservationsByVisit) {
    const linkedOrder = group.map((row) => orderBySource.get(row.source_id)).find(Boolean);
    if (linkedOrder) claimedOrders.add(linkedOrder.id);
    const completedAt = linkedOrder ? completedAtByOrder.get(linkedOrder.id) ?? null : null;
    for (const row of group) {
      const reservation = row.payload;
      const completed = linkedOrder ? Boolean(completedAt) : row.status === "Done" || reservation.status === "Done";
      const personIds = unique(
        reservation.providers
          .map((name) => specialistPeople.idByName.get(normalizeName(name)))
          .filter((id): id is string => Boolean(id)),
      );
      if (!personIds.length) continue;
      const durationMinutes = Math.max(Number(reservation.durationMinutes) || 0, 0);
      specialistEvents.push({
        id: `rekaz:${row.source_id}`,
        visitKey,
        source: "rekaz",
        sourceLabel: "حجز ركاز",
        orderId: linkedOrder?.id ?? null,
        personIds,
        arrivalAt: reservation.arrivalAt,
        endsAt: new Date(new Date(reservation.arrivalAt).getTime() + durationMinutes * 60_000).toISOString(),
        durationMinutes,
        customerName: reservation.customerName,
        customerPhone: reservation.customerPhone,
        service: reservation.service,
        status: reservation.status || row.status,
        completed,
        completedAt,
      });
    }
  }

  for (const order of orders) {
    if (claimedOrders.has(order.id) || !overlapsWindow(order.arrival_at, order.duration_minutes, startMinute, endMinute)) continue;
    const completedAt = completedAtByOrder.get(order.id) ?? null;
    if (order.specialist_id) {
      specialistEvents.push({
        id: `order:specialist:${order.id}`,
        visitKey: `order:${order.id}`,
        source: "whatsapp",
        sourceLabel: "طلب واتساب",
        orderId: order.id,
        personIds: [order.specialist_id],
        arrivalAt: order.arrival_at,
        endsAt: new Date(new Date(order.arrival_at).getTime() + order.duration_minutes * 60_000).toISOString(),
        durationMinutes: order.duration_minutes,
        customerName: "",
        customerPhone: order.customer_phone,
        service: "طلب خدمة",
        status: completedAt ? "Done" : "Scheduled",
        completed: Boolean(completedAt),
        completedAt,
      });
    }
  }

  const driverEvents: OperationsEvent[] = [];
  for (const order of orders) {
    if (!order.driver_id || !overlapsWindow(order.arrival_at, order.duration_minutes, startMinute, endMinute)) continue;
    const linked = reservationsByVisit.size
      ? [...reservationsByVisit.entries()].find(([, rows]) => rows.some((row) => row.source_id === order.rekaz_source_id))
      : undefined;
    const rows = linked?.[1] ?? [];
    const arrivals = rows.map((row) => new Date(row.payload.arrivalAt).getTime()).filter(Number.isFinite);
    const ends = rows
      .map((row) => new Date(row.payload.arrivalAt).getTime() + Math.max(row.payload.durationMinutes, 0) * 60_000)
      .filter(Number.isFinite);
    const arrivalAt = arrivals.length ? new Date(Math.min(...arrivals)).toISOString() : order.arrival_at;
    const durationMinutes = arrivals.length
      ? Math.max(0, Math.round((Math.max(...ends) - Math.min(...arrivals)) / 60_000))
      : order.duration_minutes;
    const completedAt = completedAtByOrder.get(order.id) ?? null;
    const first = rows[0]?.payload;
    driverEvents.push({
      id: `order:driver:${order.id}`,
      visitKey: linked?.[0] ?? `order:${order.id}`,
      source: first ? "rekaz" : "whatsapp",
      sourceLabel: first ? "حجز ركاز" : "طلب واتساب",
      orderId: order.id,
      personIds: [order.driver_id],
      arrivalAt,
      endsAt: new Date(new Date(arrivalAt).getTime() + durationMinutes * 60_000).toISOString(),
      durationMinutes,
      customerName: first?.customerName ?? "",
      customerPhone: first?.customerPhone ?? order.customer_phone,
      service: rows.length ? unique(rows.map((row) => row.payload.service).filter(Boolean)).join("، ") : "مشوار عميلة",
      status: completedAt ? "Done" : "Scheduled",
      completed: Boolean(completedAt),
      completedAt,
    });
  }

  addMetrics(specialistPeople.people, specialistEvents);
  addMetrics(driverPeople.people, driverEvents);
  const byArrival = (a: OperationsEvent, b: OperationsEvent) => a.arrivalAt.localeCompare(b.arrivalAt);

  return {
    ...input,
    timeZone: OPERATIONS_TIME_ZONE,
    generatedAt: new Date().toISOString(),
    people: { specialist: specialistPeople.people, driver: driverPeople.people },
    events: { specialist: specialistEvents.sort(byArrival), driver: driverEvents.sort(byArrival) },
  };
}
