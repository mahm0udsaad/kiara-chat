import "server-only";

import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import {
  fieldOrderStepCommand,
  type FieldLocationEvidence,
} from "@/lib/operational-commands";
import type { FieldOrderProgressState, TripType } from "@/lib/types";

export type FieldStaffRole = "specialist" | "driver";
export type FieldOrderAction =
  | "confirm_ride"
  | "driver_arrived"
  | "confirm_pickup"
  | "start_service"
  | "complete_order"
  | "driver_return";

export type FieldOrderListView = "today" | "upcoming" | "previous" | "done";

export interface FieldOrderListOptions {
  view?: FieldOrderListView;
  dayStart?: string;
  dayEnd?: string;
}

export interface FieldStaffSession {
  kind: "field";
  userId: string;
  accountId: string;
  role: FieldStaffRole;
  rosterId: string;
  displayName: string;
  phone: string | null;
}

/** One definition, shared with the operations app's order payload. */
export type FieldOrderProgress = FieldOrderProgressState;

export interface FieldOrder {
  id: string;
  specialistId: string | null;
  driverId: string | null;
  arrivalAt: string;
  durationMinutes: number;
  tripType: TripType;
  customerName: string | null;
  customerPhone: string;
  customerLocation: string;
  specialistName: string | null;
  driverName: string | null;
  progress: FieldOrderProgress;
  nextAction: FieldOrderAction | null;
  nextActionLabel: string | null;
  canAct: boolean;
  /**
   * The driver's non-blocking "I've arrived at the specialist" ping is offered
   * only to the driver, only after he has confirmed the ride and before she is
   * in the car, and only until he taps it once.
   */
  canPingArrival: boolean;
}

export interface FieldStaffAccountSummary {
  id: string;
  role: FieldStaffRole;
  rosterId: string;
  phone: string | null;
  isActive: boolean;
}

const E164 = /^\+[1-9]\d{7,14}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeLoginPhone(value: string): string {
  const trimmed = value.trim();
  const leadingPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  return leadingPlus ? `+${digits}` : digits;
}

function accountRosterId(row: Record<string, unknown>, role: FieldStaffRole): string {
  return String(role === "specialist" ? row.specialist_id : row.driver_id);
}

export async function listFieldStaffAccounts(): Promise<FieldStaffAccountSummary[]> {
  const admin = getAdminSupabaseClient();
  const { data, error } = await admin
    .from("field_staff_accounts")
    .select("id, role, specialist_id, driver_id, is_active, auth_user_id")
    .eq("restaurant_id", KIARA_RESTAURANT_ID);
  if (error) {
    if (error.message.includes("field_staff_accounts")) return [];
    throw new Error(error.message);
  }

  return Promise.all(
    (data ?? []).map(async (row) => {
      const role = row.role as FieldStaffRole;
      const auth = await admin.auth.admin.getUserById(row.auth_user_id as string);
      return {
        id: row.id as string,
        role,
        rosterId: accountRosterId(row as Record<string, unknown>, role),
        phone: auth.data.user?.phone ?? null,
        isActive: Boolean(row.is_active),
      };
    })
  );
}

export async function provisionFieldStaffAccount(input: {
  role: FieldStaffRole;
  rosterId: string;
  password: string;
}): Promise<FieldStaffAccountSummary> {
  if (!UUID.test(input.rosterId)) throw new Error("الحساب غير صحيح");
  if (input.password.length < 8) {
    throw new Error("كلمة المرور يجب أن تكون 8 أحرف على الأقل");
  }

  const admin = getAdminSupabaseClient();
  const rosterTable = input.role === "specialist" ? "specialists" : "drivers";
  const rosterColumn = input.role === "specialist" ? "specialist_id" : "driver_id";
  const { data: roster, error: rosterError } = await admin
    .from(rosterTable)
    .select("id, full_name, phone, is_active")
    .eq("id", input.rosterId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  if (rosterError) throw new Error(rosterError.message);
  if (!roster) throw new Error("الموظف غير موجود");
  if (!roster.is_active) throw new Error("فعّلي الموظف أولاً");

  const phone = normalizeLoginPhone(String(roster.phone ?? ""));
  if (!E164.test(phone)) {
    throw new Error("أضيفي رقم الموظف بصيغة دولية مثل +9665… قبل إنشاء الدخول");
  }

  const { data: existing } = await admin
    .from("field_staff_accounts")
    .select("id, auth_user_id, is_active")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .eq(rosterColumn, input.rosterId)
    .maybeSingle();

  if (existing) {
    const { error: updateAuthError } = await admin.auth.admin.updateUserById(
      existing.auth_user_id as string,
      {
        phone,
        password: input.password,
        phone_confirm: true,
        app_metadata: {
          kiara_role: input.role,
          kiara_restaurant_id: KIARA_RESTAURANT_ID,
        },
      }
    );
    if (updateAuthError) throw new Error(updateAuthError.message);
    await admin
      .from("field_staff_accounts")
      .update({ is_active: true })
      .eq("id", existing.id);
    return {
      id: existing.id as string,
      role: input.role,
      rosterId: input.rosterId,
      phone,
      isActive: true,
    };
  }

  const { data: created, error: authError } = await admin.auth.admin.createUser({
    phone,
    password: input.password,
    phone_confirm: true,
    app_metadata: {
      kiara_role: input.role,
      kiara_restaurant_id: KIARA_RESTAURANT_ID,
    },
    user_metadata: { full_name: roster.full_name },
  });
  if (authError || !created.user) {
    throw new Error(authError?.message ?? "تعذّر إنشاء حساب الدخول");
  }

  const { data: account, error: accountError } = await admin
    .from("field_staff_accounts")
    .insert({
      restaurant_id: KIARA_RESTAURANT_ID,
      auth_user_id: created.user.id,
      role: input.role,
      specialist_id: input.role === "specialist" ? input.rosterId : null,
      driver_id: input.role === "driver" ? input.rosterId : null,
      is_active: true,
    })
    .select("id")
    .single();
  if (accountError) {
    await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined);
    throw new Error(accountError.message);
  }

  return {
    id: account.id as string,
    role: input.role,
    rosterId: input.rosterId,
    phone,
    isActive: true,
  };
}

export async function getFieldStaffSession(): Promise<FieldStaffSession | null> {
  const supabase = await createServerSupabaseClient();
  const { data: claims, error } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (error || typeof userId !== "string" || !userId) return null;

  const admin = getAdminSupabaseClient();
  const { data: account } = await admin
    .from("field_staff_accounts")
    .select("id, role, specialist_id, driver_id")
    .eq("auth_user_id", userId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .eq("is_active", true)
    .maybeSingle();
  if (!account) return null;

  const role = account.role as FieldStaffRole;
  const rosterId = accountRosterId(account as Record<string, unknown>, role);
  const table = role === "specialist" ? "specialists" : "drivers";
  const { data: roster } = await admin
    .from(table)
    .select("full_name, phone, is_active")
    .eq("id", rosterId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  if (!roster?.is_active) return null;

  return {
    kind: "field",
    userId,
    accountId: account.id as string,
    role,
    rosterId,
    displayName: roster.full_name as string,
    phone: (roster.phone as string | null) ?? null,
  };
}

function progressOf(row: Record<string, unknown> | null | undefined): FieldOrderProgress {
  const now = new Date().toISOString();
  return {
    driverConfirmedAt: (row?.driver_confirmed_at as string | null) ?? null,
    driverArrivedAt: (row?.driver_arrived_at as string | null) ?? null,
    specialistPickupAt: (row?.specialist_pickup_at as string | null) ?? null,
    serviceStartedAt: (row?.service_started_at as string | null) ?? null,
    completedAt: (row?.completed_at as string | null) ?? null,
    driverReturnedAt: (row?.driver_returned_at as string | null) ?? null,
    lastActivityAt: (row?.last_activity_at as string | null) ?? now,
    lastReminderAt: (row?.last_reminder_at as string | null) ?? null,
    version: Number(row?.version ?? 1),
  };
}

export function nextFieldAction(
  progress: FieldOrderProgress
): { action: FieldOrderAction | null; role: FieldStaffRole | null; label: string | null } {
  if (!progress.driverConfirmedAt) {
    return { action: "confirm_ride", role: "driver", label: "تأكيد الرحلة والانطلاق" };
  }
  if (!progress.specialistPickupAt) {
    return { action: "confirm_pickup", role: "specialist", label: "ركبتُ مع السائق" };
  }
  if (!progress.serviceStartedAt) {
    return { action: "start_service", role: "specialist", label: "بدء الخدمة عند العميلة" };
  }
  if (!progress.completedAt) {
    return { action: "complete_order", role: "specialist", label: "إنهاء الخدمة والمغادرة" };
  }
  if (!progress.driverReturnedAt) {
    return { action: "driver_return", role: "driver", label: "إنهاء الرحلة والعودة" };
  }
  return { action: null, role: null, label: null };
}

/**
 * Whether the driver may fire the non-blocking "I reached the specialist" ping
 * for a given progress state. Kept beside {@link nextFieldAction} so the linear
 * chain and this side event stay defined in one place.
 */
export function driverArrivalPingAvailable(progress: FieldOrderProgress): boolean {
  return Boolean(
    progress.driverConfirmedAt &&
      !progress.driverArrivedAt &&
      !progress.specialistPickupAt,
  );
}

async function loadOrdersForSession(
  session: FieldStaffSession,
  options: FieldOrderListOptions & { orderId?: string } = {},
) {
  const admin = getAdminSupabaseClient();
  const rosterColumn = session.role === "specialist" ? "specialist_id" : "driver_id";
  let query = admin
    .from("driver_orders")
    .select(
      "id, conversation_id, specialist_id, driver_id, arrival_at, customer_location, customer_phone, duration_minutes, trip_type"
    )
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .eq(rosterColumn, session.rosterId);
  if (options.orderId) {
    query = query.eq("id", options.orderId);
  } else if (options.view && options.dayStart && options.dayEnd) {
    if (options.view === "today") {
      query = query.gte("arrival_at", options.dayStart).lt("arrival_at", options.dayEnd);
    } else if (options.view === "upcoming") {
      query = query.gte("arrival_at", options.dayEnd);
    } else if (options.view === "previous") {
      query = query.lt("arrival_at", options.dayStart);
    }
  } else if (!options.view) {
    // Backward-compatible window for older mobile builds that do not send a
    // list view yet.
    query = query
      .gte("arrival_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .lte("arrival_at", new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString());
  }
  const descending = options.view === "previous" || options.view === "done";
  query = query
    .order("arrival_at", { ascending: !descending })
    .limit(options.view === "done" ? 250 : 100);
  const { data: orders, error } = await query;
  if (error) throw new Error(error.message);
  const rows = orders ?? [];
  const conversationIds = [...new Set(rows.map((row) => row.conversation_id as string))];
  const specialistIds = [...new Set(rows.map((row) => row.specialist_id as string).filter(Boolean))];
  const driverIds = [...new Set(rows.map((row) => row.driver_id as string).filter(Boolean))];
  const orderIds = rows.map((row) => row.id as string);

  const [conversationResult, specialistResult, driverResult, progressResult] = await Promise.all([
    conversationIds.length
      ? admin.from("conversations").select("id, customer_name").in("id", conversationIds)
      : Promise.resolve({ data: [] }),
    specialistIds.length
      ? admin.from("specialists").select("id, full_name").in("id", specialistIds)
      : Promise.resolve({ data: [] }),
    driverIds.length
      ? admin.from("drivers").select("id, full_name").in("id", driverIds)
      : Promise.resolve({ data: [] }),
    orderIds.length
      ? admin.from("field_order_progress").select("*").in("order_id", orderIds)
      : Promise.resolve({ data: [] }),
  ]);

  const conversations = new Map(
    (conversationResult.data ?? []).map((row) => [row.id as string, row.customer_name as string | null])
  );
  const specialists = new Map(
    (specialistResult.data ?? []).map((row) => [row.id as string, row.full_name as string])
  );
  const drivers = new Map(
    (driverResult.data ?? []).map((row) => [row.id as string, row.full_name as string])
  );
  const progressRows = new Map(
    (progressResult.data ?? []).map((row) => [row.order_id as string, row as Record<string, unknown>])
  );

  const mapped = rows.map((row): FieldOrder => {
    const progress = progressOf(progressRows.get(row.id as string));
    const next = nextFieldAction(progress);
    return {
      id: row.id as string,
      specialistId: (row.specialist_id as string | null) ?? null,
      driverId: (row.driver_id as string | null) ?? null,
      arrivalAt: row.arrival_at as string,
      durationMinutes: Number(row.duration_minutes),
      tripType: row.trip_type as TripType,
      customerName: conversations.get(row.conversation_id as string) ?? null,
      customerPhone: row.customer_phone as string,
      customerLocation: row.customer_location as string,
      specialistName: row.specialist_id
        ? specialists.get(row.specialist_id as string) ?? null
        : null,
      driverName: row.driver_id ? drivers.get(row.driver_id as string) ?? null : null,
      progress,
      nextAction: next.action,
      nextActionLabel: next.label,
      canAct: next.role === session.role,
      canPingArrival:
        session.role === "driver" && driverArrivalPingAvailable(progress),
    };
  });
  return options.view === "done"
    ? mapped.filter((order) => Boolean(order.progress.driverReturnedAt))
    : mapped;
}

export async function listFieldOrders(
  session: FieldStaffSession,
  options: FieldOrderListOptions = {},
): Promise<FieldOrder[]> {
  await touchFieldStaffActivity(session.accountId);
  return loadOrdersForSession(session, options);
}

export async function getFieldOrder(
  session: FieldStaffSession,
  orderId: string
): Promise<FieldOrder | null> {
  if (!UUID.test(orderId)) return null;
  await touchFieldStaffActivity(session.accountId);
  return (await loadOrdersForSession(session, { orderId }))[0] ?? null;
}

export async function updateFieldOrder(
  session: FieldStaffSession,
  orderId: string,
  action: FieldOrderAction,
  command: {
    expectedVersion: number;
    idempotencyKey: string;
    location: FieldLocationEvidence | null;
  },
): Promise<FieldOrder> {
  const currentOrder = await getFieldOrder(session, orderId);
  if (!currentOrder) throw new Error("الطلب غير موجود أو غير مخصص لك");
  if (action === "driver_arrived") {
    // A side event, not part of the linear chain — validated on its own terms.
    if (session.role !== "driver") {
      throw new Error("هذه الخطوة تخص عضو الفريق الآخر");
    }
    if (!driverArrivalPingAvailable(currentOrder.progress)) {
      throw new Error("هذه الخطوة غير متاحة الآن");
    }
  } else {
    const expected = nextFieldAction(currentOrder.progress);
    if (expected.action !== action) throw new Error("هذه الخطوة غير متاحة الآن");
    if (expected.role !== session.role) throw new Error("هذه الخطوة تخص عضو الفريق الآخر");
  }

  const result = await fieldOrderStepCommand({
    restaurantId: KIARA_RESTAURANT_ID,
    orderId,
    expectedVersion: command.expectedVersion,
    idempotencyKey: command.idempotencyKey,
    actorUserId: session.userId,
    fieldStaffAccountId: session.accountId,
    role: session.role,
    rosterId: session.rosterId,
    action,
    location: command.location,
  });
  const progress = result.progress as Record<string, unknown> | undefined;
  const actionTime =
    action === "confirm_ride"
      ? progress?.driver_confirmed_at
      : action === "driver_arrived"
        ? progress?.driver_arrived_at
        : action === "confirm_pickup"
          ? progress?.specialist_pickup_at
          : action === "start_service"
            ? progress?.service_started_at
            : action === "complete_order"
              ? progress?.completed_at
              : progress?.driver_returned_at;
  const now = typeof actionTime === "string" ? actionTime : new Date().toISOString();

  await mirrorFieldProgressToConversation(orderId, action, now);

  await touchFieldStaffActivity(session.accountId, now);
  const updated = await getFieldOrder(session, orderId);
  if (!updated) throw new Error("تعذّر تحميل الطلب بعد التحديث");
  return updated;
}

async function mirrorFieldProgressToConversation(
  orderId: string,
  action: FieldOrderAction,
  at: string
): Promise<void> {
  const admin = getAdminSupabaseClient();
  const { data: order } = await admin
    .from("driver_orders")
    .select("conversation_id")
    .eq("id", orderId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  if (!order) return;
  const { data: conversation } = await admin
    .from("conversations")
    .select("metadata, status")
    .eq("id", order.conversation_id)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  if (!conversation) return;
  const metadata = (conversation.metadata as Record<string, unknown> | null) ?? {};
  const root =
    metadata.field_sessions &&
    typeof metadata.field_sessions === "object" &&
    !Array.isArray(metadata.field_sessions)
      ? (metadata.field_sessions as Record<string, unknown>)
      : {};
  const orderRoot =
    root[orderId] && typeof root[orderId] === "object" && !Array.isArray(root[orderId])
      ? (root[orderId] as Record<string, unknown>)
      : {};
  const driver =
    orderRoot.driver && typeof orderRoot.driver === "object" && !Array.isArray(orderRoot.driver)
      ? (orderRoot.driver as Record<string, unknown>)
      : {};
  const specialist =
    orderRoot.specialist &&
    typeof orderRoot.specialist === "object" &&
    !Array.isArray(orderRoot.specialist)
      ? (orderRoot.specialist as Record<string, unknown>)
      : {};

  const nextDriver = { ...driver };
  const nextSpecialist = { ...specialist };
  if (action === "confirm_ride") nextDriver.started_at = driver.started_at ?? at;
  if (action === "driver_arrived") nextDriver.arrived_at = driver.arrived_at ?? at;
  if (action === "start_service") {
    nextSpecialist.started_at = specialist.started_at ?? at;
  }
  if (action === "complete_order") {
    nextSpecialist.completed_at = specialist.completed_at ?? at;
  }
  // The driver's leg closes when he confirms the return trip, not when the
  // specialist starts the service — that only means he dropped her and left.
  if (action === "driver_return") nextDriver.completed_at = driver.completed_at ?? at;
  const completing = action === "complete_order";
  const nextMetadata = {
    ...metadata,
    ...(action === "start_service" || completing
      ? {
          booking_stage: completing ? "completed" : "in_progress",
          cs_status: completing ? "resolved" : "open",
        }
      : {}),
    field_sessions: {
      ...root,
      [orderId]: {
        ...orderRoot,
        driver: nextDriver,
        specialist: nextSpecialist,
      },
    },
  };
  await admin
    .from("conversations")
    .update({
      metadata: nextMetadata,
      ...(completing ? { status: "resolved" } : {}),
    })
    .eq("id", order.conversation_id)
    .eq("restaurant_id", KIARA_RESTAURANT_ID);
}

export async function touchFieldStaffActivity(
  accountId: string,
  at = new Date().toISOString()
): Promise<void> {
  await getAdminSupabaseClient()
    .from("field_staff_accounts")
    .update({ last_app_activity_at: at })
    .eq("id", accountId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID);
}

export async function ensureFieldOrderProgress(orderId: string): Promise<void> {
  const now = new Date().toISOString();
  await getAdminSupabaseClient().from("field_order_progress").upsert(
    {
      order_id: orderId,
      restaurant_id: KIARA_RESTAURANT_ID,
      last_activity_at: now,
    },
    { onConflict: "order_id", ignoreDuplicates: true }
  );
}
