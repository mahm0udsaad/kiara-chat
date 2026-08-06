import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import type { FieldSessionState, TripType } from "@/lib/types";

export type FieldSessionRole = "specialist" | "driver";
export type FieldSessionAction = "start" | "complete";

export interface FieldSessionVisit {
  id: string;
  arrivalAt: string;
  durationMinutes: number;
  tripType: TripType;
  customerName: string | null;
  customerPhone: string;
  customerLocation: string;
  specialistName: string | null;
  driverName: string | null;
  state: FieldSessionState;
}

export interface FieldSessionDashboard {
  role: FieldSessionRole;
  personName: string;
  visits: FieldSessionVisit[];
}

interface FieldSessionTokenPayload {
  v: 1;
  role: FieldSessionRole;
  rosterId: string;
  exp: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_DAYS = 30;

function signingSecret(): string {
  const explicit = process.env.FIELD_SESSION_SECRET ?? process.env.OPENWA_SEND_TOKEN;
  if (explicit) return explicit;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error("Field-session links are not configured");
  // Domain-separate the fallback: the database credential itself is never used
  // as token material or returned, only as the key for a one-way derivation.
  return createHmac("sha256", serviceKey)
    .update("kiara-field-session-links-v1")
    .digest("hex");
}

function sign(encodedPayload: string): string {
  return createHmac("sha256", signingSecret())
    .update(encodedPayload)
    .digest("base64url");
}

export function createFieldSessionToken(
  role: FieldSessionRole,
  rosterId: string
): string {
  if (!UUID.test(rosterId)) throw new Error("Invalid roster id");
  const payload: FieldSessionTokenPayload = {
    v: 1,
    role,
    rosterId,
    exp: Date.now() + TOKEN_DAYS * 24 * 60 * 60 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifyFieldSessionToken(token: string): FieldSessionTokenPayload {
  const [encoded, suppliedSignature, extra] = token.split(".");
  if (!encoded || !suppliedSignature || extra) throw new Error("الرابط غير صحيح");
  const expected = Buffer.from(sign(encoded));
  const supplied = Buffer.from(suppliedSignature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    throw new Error("الرابط غير صحيح");
  }

  let payload: FieldSessionTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new Error("الرابط غير صحيح");
  }
  if (
    payload.v !== 1 ||
    (payload.role !== "specialist" && payload.role !== "driver") ||
    !UUID.test(payload.rosterId) ||
    !Number.isFinite(payload.exp) ||
    payload.exp < Date.now()
  ) {
    throw new Error("انتهت صلاحية الرابط أو أنه غير صحيح");
  }
  return payload;
}

function appOrigin(): string | null {
  const explicit = process.env.KIARA_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  return vercel ? `https://${vercel.replace(/\/+$/, "")}` : null;
}

export function fieldSessionLink(
  role: FieldSessionRole,
  rosterId: string
): string | null {
  const origin = appOrigin();
  if (!origin) return null;
  return `${origin}/session/${createFieldSessionToken(role, rosterId)}`;
}

export function fieldSessionStateOf(
  metadata: Record<string, unknown> | null,
  orderId: string,
  role: FieldSessionRole
): FieldSessionState {
  const root = metadata?.field_sessions;
  if (!root || typeof root !== "object" || Array.isArray(root)) {
    return { started_at: null, completed_at: null };
  }
  const orderState = (root as Record<string, unknown>)[orderId];
  if (!orderState || typeof orderState !== "object" || Array.isArray(orderState)) {
    return { started_at: null, completed_at: null };
  }
  const roleState = (orderState as Record<string, unknown>)[role];
  if (!roleState || typeof roleState !== "object" || Array.isArray(roleState)) {
    return { started_at: null, completed_at: null };
  }
  const value = roleState as Record<string, unknown>;
  return {
    started_at: typeof value.started_at === "string" ? value.started_at : null,
    completed_at: typeof value.completed_at === "string" ? value.completed_at : null,
  };
}

export async function getFieldSessionDashboard(
  token: string
): Promise<FieldSessionDashboard> {
  const payload = verifyFieldSessionToken(token);
  const admin = getAdminSupabaseClient();
  const rosterTable = payload.role === "specialist" ? "specialists" : "drivers";
  const rosterColumn = payload.role === "specialist" ? "specialist_id" : "driver_id";
  const from = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  const to = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: person }, { data: orders, error: orderError }] = await Promise.all([
    admin
      .from(rosterTable)
      .select("id, full_name, is_active")
      .eq("id", payload.rosterId)
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .eq("is_active", true)
      .maybeSingle(),
    admin
      .from("driver_orders")
      .select(
        "id, conversation_id, specialist_id, driver_id, arrival_at, customer_location, customer_phone, duration_minutes, trip_type"
      )
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .eq(rosterColumn, payload.rosterId)
      .gte("arrival_at", from)
      .lte("arrival_at", to)
      .order("arrival_at", { ascending: true })
      .limit(50),
  ]);
  if (!person) throw new Error("هذا الرابط غير نشط");
  if (orderError) throw new Error("تعذّر تحميل الجلسات");

  const rows = orders ?? [];
  const conversationIds = [...new Set(rows.map((order) => String(order.conversation_id)))];
  const specialistIds = [
    ...new Set(rows.map((order) => order.specialist_id as string | null).filter(Boolean)),
  ] as string[];
  const driverIds = [
    ...new Set(rows.map((order) => order.driver_id as string | null).filter(Boolean)),
  ] as string[];
  const [conversationResult, specialistResult, driverResult] = await Promise.all([
    conversationIds.length
      ? admin
          .from("conversations")
          .select("id, customer_name, metadata")
          .eq("restaurant_id", KIARA_RESTAURANT_ID)
          .in("id", conversationIds)
      : Promise.resolve({ data: [], error: null }),
    specialistIds.length
      ? admin
          .from("specialists")
          .select("id, full_name")
          .eq("restaurant_id", KIARA_RESTAURANT_ID)
          .in("id", specialistIds)
      : Promise.resolve({ data: [], error: null }),
    driverIds.length
      ? admin
          .from("drivers")
          .select("id, full_name")
          .eq("restaurant_id", KIARA_RESTAURANT_ID)
          .in("id", driverIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const conversations = new Map(
    (conversationResult.data ?? []).map((conversation) => [
      conversation.id as string,
      {
        customerName: (conversation.customer_name as string | null) ?? null,
        metadata: (conversation.metadata as Record<string, unknown> | null) ?? null,
      },
    ])
  );
  const specialists = new Map(
    (specialistResult.data ?? []).map((item) => [item.id as string, item.full_name as string])
  );
  const drivers = new Map(
    (driverResult.data ?? []).map((item) => [item.id as string, item.full_name as string])
  );

  return {
    role: payload.role,
    personName: person.full_name as string,
    visits: rows.map((order) => {
      const conversation = conversations.get(order.conversation_id as string);
      return {
        id: order.id as string,
        arrivalAt: order.arrival_at as string,
        durationMinutes: Number(order.duration_minutes),
        tripType: order.trip_type as TripType,
        customerName: conversation?.customerName ?? null,
        customerPhone: order.customer_phone as string,
        customerLocation: order.customer_location as string,
        specialistName: order.specialist_id
          ? specialists.get(order.specialist_id as string) ?? null
          : null,
        driverName: order.driver_id
          ? drivers.get(order.driver_id as string) ?? null
          : null,
        state: fieldSessionStateOf(
          conversation?.metadata ?? null,
          order.id as string,
          payload.role
        ),
      };
    }),
  };
}

export async function updateFieldSession(
  token: string,
  orderId: string,
  action: FieldSessionAction
): Promise<FieldSessionState> {
  const payload = verifyFieldSessionToken(token);
  if (!UUID.test(orderId)) throw new Error("الجلسة غير صحيحة");
  const admin = getAdminSupabaseClient();
  const rosterTable = payload.role === "specialist" ? "specialists" : "drivers";
  const rosterColumn = payload.role === "specialist" ? "specialist_id" : "driver_id";
  const [{ data: person }, { data: order, error: orderError }] = await Promise.all([
    admin
      .from(rosterTable)
      .select("id")
      .eq("id", payload.rosterId)
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .eq("is_active", true)
      .maybeSingle(),
    admin
      .from("driver_orders")
      .select("id, conversation_id")
      .eq("id", orderId)
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .eq(rosterColumn, payload.rosterId)
      .maybeSingle(),
  ]);
  if (!person) throw new Error("هذا الرابط غير نشط");
  if (orderError) throw new Error("تعذّر تحميل الجلسة");
  if (!order) throw new Error("الجلسة غير موجودة أو غير مخصصة لك");

  const { data: conversation, error: conversationError } = await admin
    .from("conversations")
    .select("metadata, status")
    .eq("id", order.conversation_id)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  if (conversationError) throw new Error("تعذّر تحميل بيانات الجلسة");
  if (!conversation) throw new Error("بيانات الجلسة غير موجودة");

  const metadata =
    (conversation.metadata as Record<string, unknown> | null) ?? {};
  const current = fieldSessionStateOf(metadata, orderId, payload.role);
  if (action === "start" && current.completed_at) {
    throw new Error("تم إنهاء هذه الجلسة بالفعل");
  }
  if (action === "complete" && !current.started_at) {
    throw new Error("يجب تأكيد البداية أولاً");
  }
  const now = new Date().toISOString();
  const next: FieldSessionState =
    action === "start"
      ? { started_at: current.started_at ?? now, completed_at: current.completed_at }
      : { started_at: current.started_at, completed_at: current.completed_at ?? now };
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
  const nextMetadata: Record<string, unknown> = {
    ...metadata,
    field_sessions: {
      ...root,
      [orderId]: { ...orderRoot, [payload.role]: next },
    },
  };
  if (payload.role === "specialist") {
    nextMetadata.booking_stage = action === "start" ? "in_progress" : "completed";
    nextMetadata.cs_status = action === "start" ? "open" : "resolved";
  }

  const { error } = await admin
    .from("conversations")
    .update({
      metadata: nextMetadata,
      status:
        payload.role === "specialist"
          ? action === "complete"
            ? "resolved"
            : "active"
          : conversation.status,
    })
    .eq("id", order.conversation_id)
    .eq("restaurant_id", KIARA_RESTAURANT_ID);
  if (error) throw new Error("تعذّر حفظ حالة الجلسة");
  return next;
}
