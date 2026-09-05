import "server-only";

import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import {
  OPERATIONS_TIME_ZONE,
  type OperationsReportInput,
  validateOperationsReportInput,
} from "@/lib/operations-report";
import type { RekazReservation } from "@/lib/reservations";

export type OrdersReportDay = {
  day: string;
  total: number;
  completed: number;
  active: number;
  cancelled: number;
  edited: number;
  revenue: number;
};

export type OrdersReport = {
  from: string;
  to: string;
  timeZone: typeof OPERATIONS_TIME_ZONE;
  generatedAt: string;
  totals: {
    total: number;
    completed: number;
    rekazDone: number;
    fieldCompleted: number;
    active: number;
    cancelled: number;
    edited: number;
    dispatched: number;
    completionRate: number;
    serviceRevenue: number;
    transportRevenue: number;
    refunded: number;
    totalRevenue: number;
  };
  daily: OrdersReportDay[];
};

type ReservationRow = {
  source_id: string;
  source_order_id: string | null;
  arrival_at: string;
  status: string;
  removed_at: string | null;
  payload: RekazReservation;
};

type LocalOrderRow = {
  id: string;
  arrival_at: string;
  price: number | null;
  status: string;
  sent_at: string | null;
  rekaz_source_id: string | null;
};

type ProgressRow = { order_id: string; completed_at: string | null };
type ChangeRow = { source_id: string; change_type: string };
type EditEventRow = { aggregate_id: string };

type AggregateOrder = {
  key: string;
  day: string;
  reservationSourceIds: Set<string>;
  reservations: ReservationRow[];
  local: LocalOrderRow | null;
};

function boundary(day: string, time: string) {
  return `${day}T${time}:00+03:00`;
}

function dayOf(iso: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: OPERATIONS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function money(value: number) {
  return Math.round(value * 100) / 100;
}

export async function getOrdersReport(raw: OperationsReportInput): Promise<OrdersReport> {
  const input = validateOperationsReportInput(raw);
  const admin = getAdminSupabaseClient();
  const rangeStart = boundary(input.from, "00:00");
  const rangeEnd = boundary(input.to, "23:59");
  const [reservationResult, localResult] = await Promise.all([
    admin
      .from("rekaz_reservations")
      .select("source_id, source_order_id, arrival_at, status, removed_at, payload")
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .gte("arrival_at", rangeStart)
      .lte("arrival_at", rangeEnd),
    admin
      .from("driver_orders")
      .select("id, arrival_at, price, status, sent_at, rekaz_source_id")
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .gte("arrival_at", rangeStart)
      .lte("arrival_at", rangeEnd),
  ]);
  if (reservationResult.error) throw new Error(reservationResult.error.message);
  if (localResult.error) throw new Error(localResult.error.message);
  const reservations = (reservationResult.data ?? []) as ReservationRow[];
  const locals = (localResult.data ?? []) as LocalOrderRow[];

  const [progressResult, changesResult, editEventsResult] = await Promise.all([
    locals.length
      ? admin
          .from("field_order_progress")
          .select("order_id, completed_at")
          .eq("restaurant_id", KIARA_RESTAURANT_ID)
          .in("order_id", locals.map((order) => order.id))
      : Promise.resolve({ data: [], error: null }),
    reservations.length
      ? admin
          .from("rekaz_changes")
          .select("source_id, change_type")
          .eq("restaurant_id", KIARA_RESTAURANT_ID)
          .in("source_id", reservations.map((row) => row.source_id))
          .in("change_type", ["updated", "removed", "restored"])
      : Promise.resolve({ data: [], error: null }),
    locals.length
      ? admin
          .from("operation_events")
          .select("aggregate_id")
          .eq("restaurant_id", KIARA_RESTAURANT_ID)
          .eq("aggregate_type", "driver_order")
          .in("aggregate_id", locals.map((order) => order.id))
          .in("event_type", ["order.updated", "order.service_approved"])
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (progressResult.error) throw new Error(progressResult.error.message);
  if (changesResult.error) throw new Error(changesResult.error.message);
  if (editEventsResult.error) throw new Error(editEventsResult.error.message);
  const completedLocalIds = new Set(
    ((progressResult.data ?? []) as ProgressRow[])
      .filter((row) => Boolean(row.completed_at))
      .map((row) => row.order_id),
  );
  const changedSourceIds = new Set(
    ((changesResult.data ?? []) as ChangeRow[]).map((row) => row.source_id),
  );
  const editedLocalIds = new Set(
    ((editEventsResult.data ?? []) as EditEventRow[]).map((row) => row.aggregate_id),
  );

  const grouped = new Map<string, AggregateOrder>();
  const keyBySource = new Map<string, string>();
  for (const row of reservations) {
    const key = `rekaz:${row.source_order_id || row.payload?.order?.id || row.source_id}`;
    keyBySource.set(row.source_id, key);
    const current = grouped.get(key) ?? {
      key,
      day: dayOf(row.arrival_at),
      reservationSourceIds: new Set<string>(),
      reservations: [],
      local: null,
    };
    current.reservationSourceIds.add(row.source_id);
    current.reservations.push(row);
    grouped.set(key, current);
  }
  for (const local of locals) {
    const linkedKey = local.rekaz_source_id ? keyBySource.get(local.rekaz_source_id) : null;
    const key = linkedKey ?? `local:${local.id}`;
    const current = grouped.get(key) ?? {
      key,
      day: dayOf(local.arrival_at),
      reservationSourceIds: new Set<string>(),
      reservations: [],
      local: null,
    };
    current.local = local;
    grouped.set(key, current);
  }

  const daily = new Map<string, OrdersReportDay>();
  let completed = 0;
  let rekazDone = 0;
  let fieldCompleted = 0;
  let active = 0;
  let cancelled = 0;
  let edited = 0;
  let dispatched = 0;
  let serviceRevenue = 0;
  let transportRevenue = 0;
  let refunded = 0;

  for (const order of grouped.values()) {
    const orderRecord = order.reservations.find((row) => row.payload?.order)?.payload.order ?? null;
    const orderStatus = orderRecord?.status || "";
    const allReservationsCancelled =
      order.reservations.length > 0 &&
      order.reservations.every((row) => row.status === "Cancelled" || Boolean(row.removed_at));
    const isCancelled =
      order.local?.status === "cancelled" || orderStatus === "Cancelled" || allReservationsCancelled;
    const isFieldCompleted = !isCancelled && Boolean(order.local && completedLocalIds.has(order.local.id));
    const isRekazDone =
      !isCancelled &&
      order.reservations.length > 0 &&
      order.reservations.filter((row) => row.status !== "Cancelled").every((row) => row.status === "Done");
    const isCompleted = isFieldCompleted || isRekazDone;
    const isEdited =
      Boolean(order.local && editedLocalIds.has(order.local.id)) ||
      [...order.reservationSourceIds].some((id) => changedSourceIds.has(id));
    const isDispatched = Boolean(order.local?.sent_at || order.local?.status === "sent");
    const grossService = isCancelled
      ? 0
      : orderRecord
        ? Number(orderRecord.total) || 0
        : order.reservations.reduce((sum, row) => sum + (Number(row.payload?.amount) || 0), 0);
    const orderRefund = isCancelled ? 0 : Number(orderRecord?.refunded) || 0;
    const serviceNet = Math.max(0, grossService - orderRefund);
    const tripRevenue = isCancelled ? 0 : Number(order.local?.price) || 0;

    if (isCancelled) cancelled += 1;
    else if (isCompleted) completed += 1;
    else active += 1;
    if (isRekazDone) rekazDone += 1;
    if (isFieldCompleted) fieldCompleted += 1;
    if (isEdited) edited += 1;
    if (isDispatched) dispatched += 1;
    serviceRevenue += serviceNet;
    transportRevenue += tripRevenue;
    refunded += orderRefund;

    const day = daily.get(order.day) ?? {
      day: order.day,
      total: 0,
      completed: 0,
      active: 0,
      cancelled: 0,
      edited: 0,
      revenue: 0,
    };
    day.total += 1;
    if (isCancelled) day.cancelled += 1;
    else if (isCompleted) day.completed += 1;
    else day.active += 1;
    if (isEdited) day.edited += 1;
    day.revenue = money(day.revenue + serviceNet + tripRevenue);
    daily.set(order.day, day);
  }

  const total = grouped.size;
  return {
    from: input.from,
    to: input.to,
    timeZone: OPERATIONS_TIME_ZONE,
    generatedAt: new Date().toISOString(),
    totals: {
      total,
      completed,
      rekazDone,
      fieldCompleted,
      active,
      cancelled,
      edited,
      dispatched,
      completionRate: total - cancelled ? Math.round((completed / (total - cancelled)) * 100) : 0,
      serviceRevenue: money(serviceRevenue),
      transportRevenue: money(transportRevenue),
      refunded: money(refunded),
      totalRevenue: money(serviceRevenue + transportRevenue),
    },
    daily: [...daily.values()].sort((a, b) => b.day.localeCompare(a.day)),
  };
}
