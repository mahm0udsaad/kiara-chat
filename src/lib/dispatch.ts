/**
 * Driver dispatch: the specialists + drivers rosters and the order that gets
 * pushed to a driver's WhatsApp. All reads/writes go through the RLS-respecting
 * authed client and are pinned to Kiara's tenant (RLS enforces it too). Roster
 * writes are additionally gated to admins by the API routes.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { formatDuration, TRIP_TYPE_LABEL } from "@/lib/format";
import { nationalityOf } from "@/lib/nationalities";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import { translateMessage } from "@/lib/translate";
import { isOpenWaConfigured, openWaTransport } from "@/lib/transport/openwa";
import type {
  Specialist,
  Driver,
  DriverOrder,
  DriverOrderRow,
  DriverOrderStatus,
  DispatchSettings,
  TripType,
} from "@/lib/types";

type AuthedClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

const SPECIALIST_COLS = "id, full_name, phone, is_active, nationality";
/** Until the nationality migration runs, reads fall back to these columns. */
const LEGACY_SPECIALIST_COLS = "id, full_name, phone, is_active";
const missingNationality = (err: { message: string } | null) =>
  Boolean(err?.message.includes("nationality"));
const DRIVER_COLS = "id, full_name, phone, is_active";
const ORDER_COLS =
  "id, conversation_id, specialist_id, driver_id, arrival_at, customer_location, customer_phone, duration_minutes, trip_type, price, status, sent_at, created_at";

// -------------------------------------------------------------- pricing

/**
 * Read the tenant's dispatch prices. Owner/manager-only — the authed client is
 * used so RLS (dispatch_settings_select → is_restaurant_admin) rejects agents.
 * Returns zeros when nothing has been configured yet.
 */
export async function getDispatchSettings(): Promise<DispatchSettings> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("dispatch_settings")
    .select("full_trip_price, half_trip_price")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return {
    fullTripPrice: Number(data?.full_trip_price ?? 0),
    halfTripPrice: Number(data?.half_trip_price ?? 0),
  };
}

/** Upsert the tenant's dispatch prices. Admin-only (enforced by RLS + route). */
export async function saveDispatchSettings(
  userId: string,
  prices: DispatchSettings
): Promise<DispatchSettings> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("dispatch_settings")
    .upsert(
      {
        restaurant_id: KIARA_RESTAURANT_ID,
        full_trip_price: prices.fullTripPrice,
        half_trip_price: prices.halfTripPrice,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "restaurant_id" }
    )
    .select("full_trip_price, half_trip_price")
    .single();
  if (error) throw new Error(error.message);
  return {
    fullTripPrice: Number(data.full_trip_price),
    halfTripPrice: Number(data.half_trip_price),
  };
}

/**
 * Price for a leg, read with the service-role client so an *agent* creating an
 * order still snapshots the correct amount even though RLS hides prices from
 * them. The number is never returned to a non-admin caller.
 */
async function priceForTrip(tripType: TripType): Promise<number | null> {
  const { data } = await getAdminSupabaseClient()
    .from("dispatch_settings")
    .select("full_trip_price, half_trip_price")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  if (!data) return null;
  const raw =
    tripType === "round_trip" ? data.full_trip_price : data.half_trip_price;
  return raw == null ? null : Number(raw);
}

// ------------------------------------------------------------ specialists

export async function listSpecialists(
  opts: { activeOnly?: boolean } = {}
): Promise<Specialist[]> {
  const supabase = await createServerSupabaseClient();
  const run = async (cols: string) => {
    let q = supabase
      .from("specialists")
      .select(cols)
      .eq("restaurant_id", KIARA_RESTAURANT_ID);
    if (opts.activeOnly) q = q.eq("is_active", true);
    return q.order("full_name");
  };
  let { data, error } = await run(SPECIALIST_COLS);
  if (missingNationality(error)) ({ data, error } = await run(LEGACY_SPECIALIST_COLS));
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Specialist[];
}

export async function createSpecialist(
  userId: string,
  fullName: string,
  phone: string | null,
  nationality: string | null = null
): Promise<Specialist> {
  const supabase = await createServerSupabaseClient();
  const insert = (withNationality: boolean) =>
    supabase
      .from("specialists")
      .insert({
        restaurant_id: KIARA_RESTAURANT_ID,
        full_name: fullName.trim(),
        phone: phone?.trim() || null,
        ...(withNationality ? { nationality } : {}),
        created_by: userId,
      })
      .select(withNationality ? SPECIALIST_COLS : LEGACY_SPECIALIST_COLS)
      .single();
  let { data, error } = await insert(true);
  if (missingNationality(error)) ({ data, error } = await insert(false));
  if (error) throw new Error(error.message);
  return data as unknown as Specialist;
}

/** Fields an admin may change on a roster row; omitted keys are left untouched. */
export interface RosterPatch {
  fullName?: string;
  phone?: string | null;
  isActive?: boolean;
  /** Specialists only — the drivers table has no such column. */
  nationality?: string | null;
}

function buildRosterPatch(patch: RosterPatch): Record<string, unknown> {
  const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.fullName !== undefined) upd.full_name = patch.fullName.trim();
  if (patch.phone !== undefined) upd.phone = patch.phone?.trim() || null;
  if (patch.isActive !== undefined) upd.is_active = patch.isActive;
  if (patch.nationality !== undefined) upd.nationality = patch.nationality;
  return upd;
}

export async function updateSpecialist(
  id: string,
  patch: RosterPatch
): Promise<Specialist> {
  const supabase = await createServerSupabaseClient();
  const run = (cols: string, body: Record<string, unknown>) =>
    supabase
      .from("specialists")
      .update(body)
      .eq("id", id)
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .select(cols)
      .single();
  let { data, error } = await run(SPECIALIST_COLS, buildRosterPatch(patch));
  if (missingNationality(error)) {
    const legacy = { ...patch };
    delete legacy.nationality;
    ({ data, error } = await run(LEGACY_SPECIALIST_COLS, buildRosterPatch(legacy)));
  }
  if (error) throw new Error(error.message);
  return data as unknown as Specialist;
}

// ----------------------------------------------------------------- drivers

export async function listDrivers(
  opts: { activeOnly?: boolean } = {}
): Promise<Driver[]> {
  const supabase = await createServerSupabaseClient();
  let q = supabase
    .from("drivers")
    .select(DRIVER_COLS)
    .eq("restaurant_id", KIARA_RESTAURANT_ID);
  if (opts.activeOnly) q = q.eq("is_active", true);
  const { data, error } = await q.order("full_name");
  if (error) throw new Error(error.message);
  return (data ?? []) as Driver[];
}

export async function createDriver(
  userId: string,
  fullName: string,
  phone: string
): Promise<Driver> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("drivers")
    .insert({
      restaurant_id: KIARA_RESTAURANT_ID,
      full_name: fullName.trim(),
      phone: phone.trim(),
      created_by: userId,
    })
    .select(DRIVER_COLS)
    .single();
  if (error) throw new Error(error.message);
  return data as Driver;
}

export async function updateDriver(
  id: string,
  patch: RosterPatch
): Promise<Driver> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("drivers")
    .update(buildRosterPatch(patch))
    .eq("id", id)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .select(DRIVER_COLS)
    .single();
  if (error) throw new Error(error.message);
  return data as Driver;
}

// ------------------------------------------------------------------ orders

export interface CreateOrderInput {
  conversationId: string;
  specialistId: string;
  driverId: string;
  /** ISO 8601 with offset — the client converts the datetime-local field. */
  arrivalAt: string;
  customerLocation: string;
  durationMinutes: number;
  tripType: TripType;
  /** Optional staff note to the specialist — sent translated with her copy. */
  specialistNote?: string;
}

/**
 * Record a dispatch order and push it to the driver's WhatsApp. The order row
 * is saved first (status "pending") so it survives even if the WhatsApp send
 * fails, then flipped to "sent"/"failed" from the transport result. The
 * specialist gets her own copy (translated to her mother language when her
 * nationality implies one) — best-effort, never blocks the order.
 */
export async function createAndDispatchOrder(
  userId: string,
  input: CreateOrderInput
): Promise<{ order: DriverOrder; sent: boolean; specialistSent: boolean | null }> {
  const supabase = await createServerSupabaseClient();

  // The conversation supplies the customer's phone — never trust a client value.
  const { data: conv, error: convErr } = await supabase
    .from("conversations")
    .select("id, customer_phone, customer_name")
    .eq("id", input.conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  if (convErr) throw new Error(convErr.message);
  if (!conv) throw new Error("Conversation not found");

  type SpecialistContact = {
    id: string;
    full_name: string;
    phone: string | null;
    nationality?: string | null;
  };
  const fetchSpecialist = async (cols: string) => {
    const { data, error } = await supabase
      .from("specialists")
      .select(cols)
      .eq("id", input.specialistId)
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .maybeSingle();
    return { data: data as SpecialistContact | null, error };
  };
  const [specRes, { data: driver }] = await Promise.all([
    fetchSpecialist("id, full_name, phone, nationality"),
    supabase
      .from("drivers")
      .select("id, full_name, phone")
      .eq("id", input.driverId)
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .maybeSingle(),
  ]);
  let specialist = specRes.data;
  if (missingNationality(specRes.error))
    ({ data: specialist } = await fetchSpecialist("id, full_name, phone"));
  if (!specialist) throw new Error("Specialist not found");
  if (!driver) throw new Error("Driver not found");

  const customerPhone = conv.customer_phone as string;
  // Snapshot the price at creation so later price changes don't rewrite history.
  const price = await priceForTrip(input.tripType);

  const { data: created, error: insErr } = await supabase
    .from("driver_orders")
    .insert({
      restaurant_id: KIARA_RESTAURANT_ID,
      conversation_id: input.conversationId,
      specialist_id: input.specialistId,
      driver_id: input.driverId,
      arrival_at: input.arrivalAt,
      customer_location: input.customerLocation.trim(),
      customer_phone: customerPhone,
      duration_minutes: input.durationMinutes,
      trip_type: input.tripType,
      price,
      status: "pending",
      created_by: userId,
    })
    .select(ORDER_COLS)
    .single();
  if (insErr) throw new Error(insErr.message);

  const orderDetails = {
    specialistName: specialist.full_name as string,
    arrivalAt: input.arrivalAt,
    durationMinutes: input.durationMinutes,
    customerLocation: input.customerLocation.trim(),
    customerName: (conv.customer_name as string | null) ?? null,
    customerPhone,
    tripType: input.tripType,
  };
  const message = formatDriverOrderMessage(orderDetails);

  let sent = false;
  if (isOpenWaConfigured()) {
    try {
      await openWaTransport.sendText(driver.phone as string, message);
      sent = true;
    } catch {
      sent = false;
    }
  }

  // The specialist's own copy — translated when her nationality implies a
  // non-Arabic mother language. null = not attempted (no phone / no WhatsApp).
  let specialistSent: boolean | null = null;
  const specialistPhone = (specialist.phone as string | null)?.trim();
  if (specialistPhone && isOpenWaConfigured()) {
    const arabicCopy = formatSpecialistOrderMessage({
      ...orderDetails,
      driverName: driver.full_name as string,
      note: input.specialistNote?.trim() || null,
    });
    const target = nationalityOf(
      (specialist as { nationality?: string | null }).nationality
    )?.targetLanguage;
    const translated = target ? await translateMessage(arabicCopy, target) : null;
    try {
      await openWaTransport.sendText(specialistPhone, translated ?? arabicCopy);
      specialistSent = true;
    } catch {
      specialistSent = false;
    }
  }

  const status: DriverOrderStatus = sent ? "sent" : "failed";
  const { data: updated } = await supabase
    .from("driver_orders")
    .update({
      status,
      sent_at: sent ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", created.id)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .select(ORDER_COLS)
    .single();

  // The order IS the resolution of the bot's booking request — clear the badge.
  await clearBookingRequest(input.conversationId).catch(() => {});

  return { order: (updated ?? created) as DriverOrder, sent, specialistSent };
}

/** Drop the bot-collected booking_request flag from a conversation, if any. */
export async function clearBookingRequest(conversationId: string): Promise<void> {
  const admin = getAdminSupabaseClient();
  const { data: conv } = await admin
    .from("conversations")
    .select("metadata")
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  const metadata = (conv?.metadata as Record<string, unknown> | null) ?? null;
  if (!metadata || !("booking_request" in metadata)) return;
  const rest = { ...metadata };
  delete rest.booking_request;
  await admin
    .from("conversations")
    .update({ metadata: rest })
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID);
}

/** Recent orders for a conversation. */
export async function listOrdersForConversation(
  conversationId: string
): Promise<DriverOrder[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("driver_orders")
    .select(ORDER_COLS)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as DriverOrder[];
}

/** Newest-arrival-first orders for the /orders view, with names resolved. */
export async function listDriverOrders(limit = 200): Promise<DriverOrderRow[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("driver_orders")
    .select(ORDER_COLS)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .order("arrival_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return withNames(supabase, (data ?? []) as DriverOrder[]);
}

/**
 * Push an existing order to its driver's WhatsApp again — the recovery path for
 * a send that failed (or a driver who lost the message). The message is rebuilt
 * from the stored row so a resend always mirrors the saved order, and the row's
 * status/sent_at follow the new attempt.
 */
export async function resendDriverOrder(
  id: string
): Promise<{ order: DriverOrderRow; sent: boolean }> {
  const supabase = await createServerSupabaseClient();

  const { data: order, error } = await supabase
    .from("driver_orders")
    .select(ORDER_COLS)
    .eq("id", id)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!order) throw new Error("الطلب غير موجود");
  if (!order.driver_id) throw new Error("لا يوجد سائق مرتبط بهذا الطلب");
  if (!isOpenWaConfigured()) throw new Error("واتساب غير مربوط");

  const row = order as DriverOrder;
  const [{ data: driver }, specialists, { data: conv }] = await Promise.all([
    supabase
      .from("drivers")
      .select("id, full_name, phone")
      .eq("id", row.driver_id)
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .maybeSingle(),
    rosterNames(supabase, "specialists", row.specialist_id ? [row.specialist_id] : []),
    supabase
      .from("conversations")
      .select("id, customer_name")
      .eq("id", row.conversation_id)
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .maybeSingle(),
  ]);
  if (!driver?.phone) throw new Error("رقم السائق غير متوفر");

  const message = formatDriverOrderMessage({
    specialistName:
      (row.specialist_id && specialists.get(row.specialist_id)?.fullName) || "—",
    arrivalAt: row.arrival_at,
    durationMinutes: row.duration_minutes,
    customerLocation: row.customer_location,
    customerName: (conv?.customer_name as string | null) ?? null,
    customerPhone: row.customer_phone,
    tripType: row.trip_type,
  });

  let sent = false;
  try {
    await openWaTransport.sendText(driver.phone as string, message);
    sent = true;
  } catch {
    sent = false;
  }

  const status: DriverOrderStatus = sent ? "sent" : "failed";
  const { data: updated } = await supabase
    .from("driver_orders")
    .update({
      status,
      // Keep the original send time when a resend fails — it still went out once.
      sent_at: sent ? new Date().toISOString() : row.sent_at,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .select(ORDER_COLS)
    .single();

  const [enriched] = await withNames(supabase, [(updated ?? row) as DriverOrder]);
  return { order: enriched, sent };
}

/** Batch-resolve specialist/driver/customer names for a page of orders. */
async function withNames(
  supabase: AuthedClient,
  orders: DriverOrder[]
): Promise<DriverOrderRow[]> {
  if (!orders.length) return [];
  const uniq = (values: (string | null)[]) => [
    ...new Set(values.filter((v): v is string => Boolean(v))),
  ];

  const [specialists, drivers, customers] = await Promise.all([
    rosterNames(supabase, "specialists", uniq(orders.map((o) => o.specialist_id))),
    rosterNames(supabase, "drivers", uniq(orders.map((o) => o.driver_id))),
    customerNames(supabase, uniq(orders.map((o) => o.conversation_id))),
  ]);

  return orders.map((o) => {
    const driver = o.driver_id ? drivers.get(o.driver_id) : undefined;
    return {
      ...o,
      specialist_name: (o.specialist_id && specialists.get(o.specialist_id)?.fullName) || null,
      driver_name: driver?.fullName ?? null,
      driver_phone: driver?.phone ?? null,
      customer_name: customers.get(o.conversation_id) ?? null,
    };
  });
}

async function rosterNames(
  supabase: AuthedClient,
  table: "specialists" | "drivers",
  ids: string[]
): Promise<Map<string, { fullName: string; phone: string | null }>> {
  if (!ids.length) return new Map();
  const { data } = await supabase
    .from(table)
    .select("id, full_name, phone")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .in("id", ids);
  return new Map(
    (data ?? []).map((r) => [
      r.id as string,
      { fullName: r.full_name as string, phone: (r.phone as string | null) ?? null },
    ])
  );
}

async function customerNames(
  supabase: AuthedClient,
  ids: string[]
): Promise<Map<string, string | null>> {
  if (!ids.length) return new Map();
  const { data } = await supabase
    .from("conversations")
    .select("id, customer_name")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .in("id", ids);
  return new Map(
    (data ?? []).map((r) => [r.id as string, (r.customer_name as string | null) ?? null])
  );
}

// --------------------------------------------------------------- formatting

const TZ = "Asia/Riyadh"; // Kiara operates in KSA; format arrival stably here.

const ARRIVAL_FMT = new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TZ,
});

export function formatDriverOrderMessage(o: {
  specialistName: string;
  arrivalAt: string;
  durationMinutes: number;
  customerLocation: string;
  customerName: string | null;
  customerPhone: string;
  tripType: TripType;
}): string {
  const arrival = ARRIVAL_FMT.format(new Date(o.arrivalAt));
  const who = o.customerName ? `${o.customerName} (${o.customerPhone})` : o.customerPhone;
  return [
    "🚗 *طلب جديد*",
    "",
    `👩 الأخصائية: ${o.specialistName}`,
    `🕒 موعد الوصول: ${arrival}`,
    `⏱️ مدة الجلسة: ${formatDuration(o.durationMinutes)}`,
    `🚕 نوع الرحلة: ${TRIP_TYPE_LABEL[o.tripType]}`,
    `📍 موقع الزبونة: ${o.customerLocation}`,
    `📞 رقم الزبونة: ${who}`,
  ].join("\n");
}

/**
 * The specialist's copy of the order — written in Arabic and translated to her
 * mother language before sending (see createAndDispatchOrder). No price: like
 * the driver message, amounts stay owner-only.
 */
export function formatSpecialistOrderMessage(o: {
  specialistName: string;
  driverName: string;
  arrivalAt: string;
  durationMinutes: number;
  customerLocation: string;
  customerName: string | null;
  customerPhone: string;
  tripType: TripType;
  note: string | null;
}): string {
  const arrival = ARRIVAL_FMT.format(new Date(o.arrivalAt));
  const who = o.customerName ? `${o.customerName} (${o.customerPhone})` : o.customerPhone;
  const lines = [
    "🌸 *موعد جديد لكِ*",
    "",
    `👩 الأخصائية: ${o.specialistName}`,
    `🕒 موعد الوصول: ${arrival}`,
    `⏱️ مدة الجلسة: ${formatDuration(o.durationMinutes)}`,
    `🚕 نوع الرحلة: ${TRIP_TYPE_LABEL[o.tripType]} — مع السائق ${o.driverName}`,
    `📍 موقع الزبونة: ${o.customerLocation}`,
    `📞 الزبونة: ${who}`,
  ];
  if (o.note) lines.push("", `📝 ملاحظة من الفريق: ${o.note}`);
  return lines.join("\n");
}
