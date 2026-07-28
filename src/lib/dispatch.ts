/**
 * Driver dispatch: the specialists + drivers rosters and the order that gets
 * pushed to a driver's WhatsApp. All reads/writes go through the RLS-respecting
 * authed client and are pinned to Kiara's tenant (RLS enforces it too). Roster
 * writes are additionally gated to admins by the API routes.
 */
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import { isOpenWaConfigured, openWaTransport } from "@/lib/transport/openwa";
import type {
  Specialist,
  Driver,
  DriverOrder,
  DriverOrderStatus,
} from "@/lib/types";

const SPECIALIST_COLS = "id, full_name, phone, is_active";
const DRIVER_COLS = "id, full_name, phone, is_active";
const ORDER_COLS =
  "id, conversation_id, specialist_id, driver_id, arrival_at, customer_location, customer_phone, duration_minutes, status, sent_at, created_at";

// ------------------------------------------------------------ specialists

export async function listSpecialists(
  opts: { activeOnly?: boolean } = {}
): Promise<Specialist[]> {
  const supabase = await createServerSupabaseClient();
  let q = supabase
    .from("specialists")
    .select(SPECIALIST_COLS)
    .eq("restaurant_id", KIARA_RESTAURANT_ID);
  if (opts.activeOnly) q = q.eq("is_active", true);
  const { data, error } = await q.order("full_name");
  if (error) throw new Error(error.message);
  return (data ?? []) as Specialist[];
}

export async function createSpecialist(
  userId: string,
  fullName: string,
  phone: string | null
): Promise<Specialist> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("specialists")
    .insert({
      restaurant_id: KIARA_RESTAURANT_ID,
      full_name: fullName.trim(),
      phone: phone?.trim() || null,
      created_by: userId,
    })
    .select(SPECIALIST_COLS)
    .single();
  if (error) throw new Error(error.message);
  return data as Specialist;
}

export async function setSpecialistActive(
  id: string,
  isActive: boolean
): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("specialists")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("restaurant_id", KIARA_RESTAURANT_ID);
  if (error) throw new Error(error.message);
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

export async function setDriverActive(
  id: string,
  isActive: boolean
): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("drivers")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("restaurant_id", KIARA_RESTAURANT_ID);
  if (error) throw new Error(error.message);
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
}

/**
 * Record a dispatch order and push it to the driver's WhatsApp. The order row
 * is saved first (status "pending") so it survives even if the WhatsApp send
 * fails, then flipped to "sent"/"failed" from the transport result.
 */
export async function createAndDispatchOrder(
  userId: string,
  input: CreateOrderInput
): Promise<{ order: DriverOrder; sent: boolean }> {
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

  const [{ data: specialist }, { data: driver }] = await Promise.all([
    supabase
      .from("specialists")
      .select("id, full_name")
      .eq("id", input.specialistId)
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .maybeSingle(),
    supabase
      .from("drivers")
      .select("id, full_name, phone")
      .eq("id", input.driverId)
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .maybeSingle(),
  ]);
  if (!specialist) throw new Error("Specialist not found");
  if (!driver) throw new Error("Driver not found");

  const customerPhone = conv.customer_phone as string;

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
      status: "pending",
      created_by: userId,
    })
    .select(ORDER_COLS)
    .single();
  if (insErr) throw new Error(insErr.message);

  const message = formatDriverOrderMessage({
    specialistName: specialist.full_name as string,
    arrivalAt: input.arrivalAt,
    durationMinutes: input.durationMinutes,
    customerLocation: input.customerLocation.trim(),
    customerName: (conv.customer_name as string | null) ?? null,
    customerPhone,
  });

  let sent = false;
  if (isOpenWaConfigured()) {
    try {
      await openWaTransport.sendText(driver.phone as string, message);
      sent = true;
    } catch {
      sent = false;
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

  return { order: (updated ?? created) as DriverOrder, sent };
}

/** Recent orders for a conversation (for a future "orders" view; unused today). */
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

/** "٩٠" → "ساعة ونصف" is too clever; use hours/minutes plainly. */
export function formatDuration(minutes: number): string {
  const n = (v: number) => v.toLocaleString("ar-SA");
  if (minutes < 60) return `${n(minutes)} دقيقة`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = h === 1 ? "ساعة" : h === 2 ? "ساعتان" : `${n(h)} ساعات`;
  if (m === 0) return hours;
  return `${hours} و${n(m)} دقيقة`;
}

export function formatDriverOrderMessage(o: {
  specialistName: string;
  arrivalAt: string;
  durationMinutes: number;
  customerLocation: string;
  customerName: string | null;
  customerPhone: string;
}): string {
  const arrival = ARRIVAL_FMT.format(new Date(o.arrivalAt));
  const who = o.customerName ? `${o.customerName} (${o.customerPhone})` : o.customerPhone;
  return [
    "🚗 *طلب جديد*",
    "",
    `👩 الأخصائية: ${o.specialistName}`,
    `🕒 موعد الوصول: ${arrival}`,
    `⏱️ مدة الجلسة: ${formatDuration(o.durationMinutes)}`,
    `📍 موقع الزبونة: ${o.customerLocation}`,
    `📞 رقم الزبونة: ${who}`,
  ].join("\n");
}
