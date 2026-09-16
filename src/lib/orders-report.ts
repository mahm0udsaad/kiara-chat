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
  notDone: number;
  active: number;
  cancelled: number;
  edited: number;
  revenue: number;
};

export type OrderProblemKind =
  | "late"
  | "service_overrun"
  | "missing_trip_cost"
  | "not_done";

export type OrderProblem = {
  orderId: string;
  customerName: string | null;
  customerPhone: string;
  driverName: string | null;
  arrivalAt: string;
  bookedServiceMinutes: number;
  actualServiceMinutes: number | null;
  lateMinutes: number;
  overrunMinutes: number;
  tripCost: number | null;
  completionNote: string | null;
  kinds: OrderProblemKind[];
};

export type OrderOutcomeAudit = {
  orderId: string;
  customerName: string | null;
  customerPhone: string;
  arrivalAt: string;
  completedAt: string;
  outcome: "done" | "not_done";
  note: string | null;
  specialistName: string | null;
};

export type DriverSettlement = {
  driverId: string;
  driverName: string;
  orders: number;
  recordedCosts: number;
  missingCosts: number;
  totalTripCost: number;
};

export type OrdersReport = {
  from: string;
  to: string;
  timeZone: typeof OPERATIONS_TIME_ZONE;
  generatedAt: string;
  totals: {
    total: number;
    completed: number;
    notDone: number;
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
    problemOrders: number;
    lateOrders: number;
    serviceOverruns: number;
    missingTripCosts: number;
    timedOrders: number;
    bookedServiceMinutes: number;
    actualServiceMinutes: number;
    serviceVarianceMinutes: number;
    tripCosts: number;
    netAfterTripCosts: number;
  };
  daily: OrdersReportDay[];
  problems: OrderProblem[];
  outcomes: OrderOutcomeAudit[];
  driverSettlements: DriverSettlement[];
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
  conversation_id: string;
  customer_phone: string;
  specialist_id: string | null;
  driver_id: string | null;
  arrival_at: string;
  duration_minutes: number;
  price: number | null;
  status: string;
  sent_at: string | null;
  rekaz_source_id: string | null;
};

type ProgressRow = {
  order_id: string;
  service_started_at: string | null;
  completed_at: string | null;
  completion_outcome: string | null;
  completion_note: string | null;
};
type ChangeRow = { source_id: string; change_type: string };
type EditEventRow = { aggregate_id: string };
type NameRow = { id: string; full_name?: string | null; customer_name?: string | null };

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
      .select("id, conversation_id, customer_phone, specialist_id, driver_id, arrival_at, duration_minutes, price, status, sent_at, rekaz_source_id")
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .gte("arrival_at", rangeStart)
      .lte("arrival_at", rangeEnd),
  ]);
  if (reservationResult.error) throw new Error(reservationResult.error.message);
  if (localResult.error) throw new Error(localResult.error.message);
  const reservations = (reservationResult.data ?? []) as ReservationRow[];
  const locals = (localResult.data ?? []) as LocalOrderRow[];

  const driverIds = [...new Set(locals.map((order) => order.driver_id).filter((id): id is string => Boolean(id)))];
  const specialistIds = [...new Set(locals.map((order) => order.specialist_id).filter((id): id is string => Boolean(id)))];
  const conversationIds = [...new Set(locals.map((order) => order.conversation_id).filter(Boolean))];
  const [progressResult, changesResult, editEventsResult, driversResult, specialistsResult, conversationsResult] = await Promise.all([
    locals.length
      ? admin
          .from("field_order_progress")
          .select("order_id, service_started_at, completed_at, completion_outcome, completion_note")
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
    driverIds.length
      ? admin
          .from("drivers")
          .select("id, full_name")
          .eq("restaurant_id", KIARA_RESTAURANT_ID)
          .in("id", driverIds)
      : Promise.resolve({ data: [], error: null }),
    specialistIds.length
      ? admin
          .from("specialists")
          .select("id, full_name")
          .eq("restaurant_id", KIARA_RESTAURANT_ID)
          .in("id", specialistIds)
      : Promise.resolve({ data: [], error: null }),
    conversationIds.length
      ? admin
          .from("conversations")
          .select("id, customer_name")
          .eq("restaurant_id", KIARA_RESTAURANT_ID)
          .in("id", conversationIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (progressResult.error) throw new Error(progressResult.error.message);
  if (changesResult.error) throw new Error(changesResult.error.message);
  if (editEventsResult.error) throw new Error(editEventsResult.error.message);
  if (driversResult.error) throw new Error(driversResult.error.message);
  if (specialistsResult.error) throw new Error(specialistsResult.error.message);
  if (conversationsResult.error) throw new Error(conversationsResult.error.message);
  const progressByOrder = new Map(
    ((progressResult.data ?? []) as ProgressRow[]).map((row) => [row.order_id, row]),
  );
  const driverNames = new Map(
    ((driversResult.data ?? []) as NameRow[]).map((row) => [row.id, row.full_name ?? null]),
  );
  const specialistNames = new Map(
    ((specialistsResult.data ?? []) as NameRow[]).map((row) => [row.id, row.full_name ?? null]),
  );
  const customerNames = new Map(
    ((conversationsResult.data ?? []) as NameRow[]).map((row) => [row.id, row.customer_name ?? null]),
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
  let notDone = 0;
  let rekazDone = 0;
  let fieldCompleted = 0;
  let active = 0;
  let cancelled = 0;
  let edited = 0;
  let dispatched = 0;
  let serviceRevenue = 0;
  let transportRevenue = 0;
  let refunded = 0;
  let lateOrders = 0;
  let serviceOverruns = 0;
  let missingTripCosts = 0;
  let timedOrders = 0;
  let bookedServiceMinutes = 0;
  let actualServiceMinutes = 0;
  let tripCosts = 0;
  const problems: OrderProblem[] = [];
  const outcomes: OrderOutcomeAudit[] = [];
  const settlements = new Map<string, DriverSettlement>();
  const now = Date.now();

  for (const order of grouped.values()) {
    const orderRecord = order.reservations.find((row) => row.payload?.order)?.payload.order ?? null;
    const orderStatus = orderRecord?.status || "";
    const allReservationsCancelled =
      order.reservations.length > 0 &&
      order.reservations.every((row) => row.status === "Cancelled" || Boolean(row.removed_at));
    const isCancelled =
      order.local?.status === "cancelled" || orderStatus === "Cancelled" || allReservationsCancelled;
    const progress = order.local ? progressByOrder.get(order.local.id) : undefined;
    const completionOutcome = progress?.completed_at
      ? progress.completion_outcome === "not_done"
        ? "not_done" as const
        : "done" as const
      : null;
    const isNotDone = !isCancelled && completionOutcome === "not_done";
    const isFieldCompleted =
      !isCancelled && Boolean(progress?.completed_at) && !isNotDone;
    const isRekazDone =
      !isCancelled &&
      order.reservations.length > 0 &&
      order.reservations.filter((row) => row.status !== "Cancelled").every((row) => row.status === "Done");
    // A first-hand field report that the service was not performed overrides
    // Rekaz's commercial "Done" flag for operational auditing.
    const isCompleted = !isNotDone && (isFieldCompleted || isRekazDone);
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
    else if (isNotDone) notDone += 1;
    else active += 1;
    if (isRekazDone) rekazDone += 1;
    if (isFieldCompleted) fieldCompleted += 1;
    if (isEdited) edited += 1;
    if (isDispatched) dispatched += 1;
    serviceRevenue += serviceNet;
    transportRevenue += tripRevenue;
    refunded += orderRefund;

    if (order.local && !isCancelled) {
      const local = order.local;
      if (progress?.completed_at && completionOutcome) {
        outcomes.push({
          orderId: local.id,
          customerName: customerNames.get(local.conversation_id) ?? null,
          customerPhone: local.customer_phone,
          arrivalAt: local.arrival_at,
          completedAt: progress.completed_at,
          outcome: completionOutcome,
          note: progress.completion_note?.trim() || null,
          specialistName: local.specialist_id
            ? specialistNames.get(local.specialist_id) ?? null
            : null,
        });
      }
      const serviceStart = progress?.service_started_at ? Date.parse(progress.service_started_at) : NaN;
      const serviceEnd = progress?.completed_at ? Date.parse(progress.completed_at) : NaN;
      const actualMinutes = Number.isFinite(serviceStart) && Number.isFinite(serviceEnd) && serviceEnd >= serviceStart
        ? Math.round((serviceEnd - serviceStart) / 60_000)
        : null;
      const scheduledAt = Date.parse(local.arrival_at);
      const lateMinutes = Number.isFinite(serviceStart) && Number.isFinite(scheduledAt)
        ? Math.max(0, Math.round((serviceStart - scheduledAt) / 60_000))
        : !isCompleted && isDispatched && Number.isFinite(scheduledAt) && now > scheduledAt
          ? Math.round((now - scheduledAt) / 60_000)
          : 0;
      const overrunMinutes = actualMinutes == null ? 0 : Math.max(0, actualMinutes - local.duration_minutes);
      const isLate = lateMinutes > 15;
      const isOverrun = overrunMinutes > 15;
      const isMissingCost = Boolean(local.driver_id && isDispatched && local.price == null);

      if (actualMinutes != null) {
        timedOrders += 1;
        bookedServiceMinutes += local.duration_minutes;
        actualServiceMinutes += actualMinutes;
      }
      if (isLate) lateOrders += 1;
      if (isOverrun) serviceOverruns += 1;
      if (isMissingCost) missingTripCosts += 1;
      if (isDispatched && local.price != null) tripCosts += Number(local.price) || 0;

      if (local.driver_id && isDispatched) {
        const current = settlements.get(local.driver_id) ?? {
          driverId: local.driver_id,
          driverName: driverNames.get(local.driver_id) || "سائق غير مسمى",
          orders: 0,
          recordedCosts: 0,
          missingCosts: 0,
          totalTripCost: 0,
        };
        current.orders += 1;
        if (local.price == null) current.missingCosts += 1;
        else {
          current.recordedCosts += 1;
          current.totalTripCost = money(current.totalTripCost + Number(local.price));
        }
        settlements.set(local.driver_id, current);
      }

      const kinds: OrderProblemKind[] = [];
      if (isLate) kinds.push("late");
      if (isOverrun) kinds.push("service_overrun");
      if (isMissingCost) kinds.push("missing_trip_cost");
      if (isNotDone) kinds.push("not_done");
      if (kinds.length) {
        problems.push({
          orderId: local.id,
          customerName: customerNames.get(local.conversation_id) ?? null,
          customerPhone: local.customer_phone,
          driverName: local.driver_id ? driverNames.get(local.driver_id) ?? null : null,
          arrivalAt: local.arrival_at,
          bookedServiceMinutes: local.duration_minutes,
          actualServiceMinutes: actualMinutes,
          lateMinutes,
          overrunMinutes,
          tripCost: local.price == null ? null : Number(local.price),
          completionNote: progress?.completion_note?.trim() || null,
          kinds,
        });
      }
    }

    const day = daily.get(order.day) ?? {
      day: order.day,
      total: 0,
      completed: 0,
      notDone: 0,
      active: 0,
      cancelled: 0,
      edited: 0,
      revenue: 0,
    };
    day.total += 1;
    if (isCancelled) day.cancelled += 1;
    else if (isCompleted) day.completed += 1;
    else if (isNotDone) day.notDone += 1;
    else day.active += 1;
    if (isEdited) day.edited += 1;
    // Driver fares are costs, not sales. Daily revenue is service revenue
    // after refunds; the cost is shown separately in the owner settlement.
    day.revenue = money(day.revenue + serviceNet);
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
      notDone,
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
      problemOrders: problems.length,
      lateOrders,
      serviceOverruns,
      missingTripCosts,
      timedOrders,
      bookedServiceMinutes,
      actualServiceMinutes,
      serviceVarianceMinutes: actualServiceMinutes - bookedServiceMinutes,
      tripCosts: money(tripCosts),
      netAfterTripCosts: money(serviceRevenue - tripCosts),
    },
    daily: [...daily.values()].sort((a, b) => b.day.localeCompare(a.day)),
    problems: problems.sort((a, b) =>
      Number(b.kinds.includes("late")) - Number(a.kinds.includes("late")) ||
      b.lateMinutes - a.lateMinutes ||
      b.arrivalAt.localeCompare(a.arrivalAt),
    ),
    outcomes: outcomes.sort((a, b) => b.completedAt.localeCompare(a.completedAt)),
    driverSettlements: [...settlements.values()].sort((a, b) =>
      b.totalTripCost - a.totalTripCost || a.driverName.localeCompare(b.driverName, "ar"),
    ),
  };
}
