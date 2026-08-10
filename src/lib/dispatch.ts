/**
 * Driver dispatch: the specialists + drivers rosters and the order that gets
 * pushed to a driver's WhatsApp. All reads/writes go through the RLS-respecting
 * authed client and are pinned to Kiara's tenant (RLS enforces it too). Roster
 * writes are additionally gated to admins by the API routes.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { formatDuration, TRIP_TYPE_LABEL } from "@/lib/format";
import { fieldSessionLink, fieldSessionStateOf } from "@/lib/field-session";
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
  "id, conversation_id, specialist_id, driver_id, arrival_at, customer_location, customer_phone, duration_minutes, trip_type, price, status, sent_at, created_at, updated_at";
/** Adds the editor. Falls back to ORDER_COLS until that migration runs. */
const ORDER_COLS_WITH_EDITOR = `${ORDER_COLS}, updated_by`;
const missingUpdatedBy = (err: { message: string } | null) =>
  Boolean(err?.message.includes("updated_by"));

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

export interface CreateBookingInput {
  conversationId: string;
  /** ISO 8601 with offset — the client converts the datetime-local field. */
  arrivalAt: string;
  customerLocation: string;
  durationMinutes: number;
  tripType: TripType;
}

/**
 * Create the visit before a specialist or driver is chosen. Both roster FKs
 * are nullable in the shared schema, so a pending row is the booking itself;
 * dispatching it later enriches that same row rather than creating a duplicate.
 */
export async function createBooking(
  userId: string,
  input: CreateBookingInput
): Promise<DriverOrder> {
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

  const { data: created, error: insErr } = await supabase
    .from("driver_orders")
    .insert({
      restaurant_id: KIARA_RESTAURANT_ID,
      conversation_id: input.conversationId,
      specialist_id: null,
      driver_id: null,
      arrival_at: input.arrivalAt,
      customer_location: input.customerLocation.trim(),
      customer_phone: conv.customer_phone as string,
      duration_minutes: input.durationMinutes,
      trip_type: input.tripType,
      price: null,
      status: "pending",
      created_by: userId,
    })
    .select(ORDER_COLS)
    .single();
  if (insErr) throw new Error(insErr.message);

  await clearBookingRequest(input.conversationId).catch(() => {});
  return created as DriverOrder;
}

export interface DispatchBookingInput {
  specialistId: string;
  driverId: string;
  /** Staff-editable WhatsApp body; the signed session link is appended server-side. */
  driverMessage?: string;
  /** Rekaz does not carry this dispatch-only choice. */
  tripType?: TripType;
  /** Optional staff note included in the translated specialist message. */
  specialistNote?: string;
  /**
   * A recorded note for the specialist, sent as its own WhatsApp message right
   * after the booking copy. Some things are faster said than typed — and a
   * specialist who reads little Arabic follows a voice far better than text.
   */
  specialistVoice?: {
    base64: string;
    contentType: string;
    filename?: string | null;
  };
}

/** Resolve the conversation before an order mutation so the route can apply
 * the same exclusive-routing authorization used by conversation actions. */
export async function getOrderConversationId(id: string): Promise<string | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("driver_orders")
    .select("conversation_id")
    .eq("id", id)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.conversation_id as string | undefined) ?? null;
}

/**
 * Assign a specialist and driver to an existing booking, then send both
 * WhatsApp messages. The specialist receives the booking copy translated to
 * her mother language when configured; the driver receives the dispatch copy.
 */
export async function dispatchBooking(
  id: string,
  input: DispatchBookingInput
): Promise<{
  order: DriverOrderRow;
  sent: boolean;
  specialistSent: boolean | null;
}> {
  const supabase = await createServerSupabaseClient();
  const { data: saved, error: orderErr } = await supabase
    .from("driver_orders")
    .select(ORDER_COLS)
    .eq("id", id)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  if (orderErr) throw new Error(orderErr.message);
  if (!saved) throw new Error("الطلب غير موجود");

  const order = saved as DriverOrder;
  if (order.status === "sent") {
    throw new Error("تم إرسال هذا الطلب بالفعل");
  }
  const tripType = input.tripType ?? order.trip_type;

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
  const specialistPromise = fetchSpecialist(
    "id, full_name, phone, nationality"
  ).then(async (result) =>
    missingNationality(result.error)
      ? (await fetchSpecialist("id, full_name, phone")).data
      : result.data
  );
  const [specialist, { data: driver }, { data: conv }, price] = await Promise.all([
    specialistPromise,
    supabase
      .from("drivers")
      .select("id, full_name, phone")
      .eq("id", input.driverId)
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .maybeSingle(),
    supabase
      .from("conversations")
      .select("id, customer_name")
      .eq("id", order.conversation_id)
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .maybeSingle(),
    priceForTrip(tripType),
  ]);
  if (!specialist) throw new Error("Specialist not found");
  if (!driver) throw new Error("Driver not found");
  if (!conv) throw new Error("Conversation not found");

  // Persist the choices before external sends so a transport failure never
  // loses the dispatch work the employee just completed.
  const { data: assigned, error: assignErr } = await supabase
    .from("driver_orders")
    .update({
      specialist_id: input.specialistId,
      driver_id: input.driverId,
      trip_type: tripType,
      price,
      status: "pending",
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .select(ORDER_COLS)
    .single();
  if (assignErr) throw new Error(assignErr.message);

  const orderDetails = {
    specialistName: specialist.full_name as string,
    arrivalAt: order.arrival_at,
    durationMinutes: order.duration_minutes,
    customerLocation: order.customer_location,
    customerName: (conv.customer_name as string | null) ?? null,
    customerPhone: order.customer_phone,
    tripType,
  };
  const driverSessionLink = fieldSessionLink("driver", input.driverId);
  const driverBody =
    input.driverMessage?.trim().slice(0, 3000) ||
    formatDriverOrderMessage(orderDetails);
  const driverMessage = driverSessionLink
    ? [
        driverBody,
        "",
        "📲 جلساتك وتأكيد البداية والنهاية:",
        driverSessionLink,
      ].join("\n")
    : driverBody;
  const specialistPhone = (specialist.phone as string | null)?.trim();
  const arabicSpecialistMessage = formatSpecialistOrderMessage({
    ...orderDetails,
    driverName: driver.full_name as string,
    note: input.specialistNote?.trim() || null,
    sessionLink: fieldSessionLink("specialist", input.specialistId),
  });

  const configured = isOpenWaConfigured();
  const driverSend = configured
    ? openWaTransport
        .sendText(driver.phone as string, driverMessage)
        .then(() => true)
        .catch(() => false)
    : Promise.resolve(false);

  const specialistSend: Promise<boolean | null> =
    configured && specialistPhone
      ? (async () => {
          const target = nationalityOf(
            (specialist as { nationality?: string | null }).nationality
          )?.targetLanguage;
          const translated = target
            ? await translateMessage(arabicSpecialistMessage, target)
            : null;
          const sentText = await openWaTransport
            .sendText(specialistPhone, translated ?? arabicSpecialistMessage)
            .then(() => true)
            .catch(() => false);
          // The recording follows the booking copy rather than replacing it —
          // she still needs the address and time in writing.
          if (input.specialistVoice) {
            await openWaTransport
              .sendMedia(specialistPhone, {
                base64: input.specialistVoice.base64,
                contentType: input.specialistVoice.contentType,
                filename: input.specialistVoice.filename ?? undefined,
                ptt: true,
              })
              .catch(() => {
                // A failed recording must not fail the dispatch: the booking
                // itself already reached her.
              });
          }
          return sentText;
        })()
      : Promise.resolve(null);

  const [sent, specialistSent] = await Promise.all([driverSend, specialistSend]);

  const status: DriverOrderStatus = sent ? "sent" : "failed";
  const { data: updated } = await supabase
    .from("driver_orders")
    .update({
      status,
      sent_at: sent ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .select(ORDER_COLS)
    .single();

  const [enriched] = await withNames(supabase, [
    (updated ?? assigned) as DriverOrder,
  ]);
  return { order: enriched, sent, specialistSent };
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
  const query = (cols: string) =>
    supabase
      .from("driver_orders")
      .select(cols)
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .order("arrival_at", { ascending: false })
      .limit(limit);

  let { data, error } = await query(ORDER_COLS_WITH_EDITOR);
  if (error && missingUpdatedBy(error)) ({ data, error } = await query(ORDER_COLS));
  if (error) throw new Error(error.message);
  return withNames(supabase, (data ?? []) as unknown as DriverOrder[]);
}

export interface OrderPatch {
  arrivalAt?: string;
  customerLocation?: string;
  durationMinutes?: number;
  tripType?: TripType;
  specialistId?: string | null;
  driverId?: string | null;
  /** Owner/manager-only — the routes gate this before calling. */
  price?: number | null;
}

/**
 * Edit a saved order. Everything the booking sheet collects stays editable
 * afterwards: plans move, a customer sends a better pin, a driver swaps out.
 *
 * Editing never re-sends — an order already on a driver's WhatsApp keeps its
 * `sent` status and the page offers "إعادة الإرسال" so the change reaches them
 * deliberately rather than as a side effect of typing.
 */
export async function updateDriverOrder(
  id: string,
  patch: OrderPatch,
  editorTeamMemberId: string | null
): Promise<DriverOrderRow> {
  const supabase = await createServerSupabaseClient();

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.arrivalAt !== undefined) update.arrival_at = patch.arrivalAt;
  if (patch.customerLocation !== undefined)
    update.customer_location = patch.customerLocation.trim();
  if (patch.durationMinutes !== undefined) update.duration_minutes = patch.durationMinutes;
  if (patch.tripType !== undefined) update.trip_type = patch.tripType;
  if (patch.specialistId !== undefined) update.specialist_id = patch.specialistId;
  if (patch.driverId !== undefined) update.driver_id = patch.driverId;
  if (patch.price !== undefined) update.price = patch.price;

  const run = (withEditor: boolean) =>
    supabase
      .from("driver_orders")
      .update(withEditor ? { ...update, updated_by: editorTeamMemberId } : update)
      .eq("id", id)
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .select(ORDER_COLS_WITH_EDITOR)
      .single();

  let { data, error } = await run(Boolean(editorTeamMemberId));
  // Until the updated_by migration runs, save the edit without the author
  // rather than failing it outright.
  if (error && missingUpdatedBy(error)) {
    ({ data, error } = await supabase
      .from("driver_orders")
      .update(update)
      .eq("id", id)
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .select(ORDER_COLS)
      .single());
  }
  if (error) throw new Error(error.message);
  if (!data) throw new Error("الطلب غير موجود");

  const [row] = await withNames(supabase, [data as DriverOrder]);
  return row;
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
  const driverId = row.driver_id;
  if (!driverId) throw new Error("لا يوجد سائق مرتبط بهذا الطلب");
  const [{ data: driver }, specialists, { data: conv }] = await Promise.all([
    supabase
      .from("drivers")
      .select("id, full_name, phone")
      .eq("id", driverId)
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
    sessionLink: fieldSessionLink("driver", driverId),
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

/** Batch-resolve specialist/driver/customer/editor names for a page of orders. */
async function withNames(
  supabase: AuthedClient,
  orders: DriverOrder[]
): Promise<DriverOrderRow[]> {
  if (!orders.length) return [];
  const uniq = (values: (string | null | undefined)[]) => [
    ...new Set(values.filter((v): v is string => Boolean(v))),
  ];

  const [specialists, drivers, customers, editors] = await Promise.all([
    rosterNames(supabase, "specialists", uniq(orders.map((o) => o.specialist_id))),
    rosterNames(supabase, "drivers", uniq(orders.map((o) => o.driver_id))),
    customerDetails(supabase, uniq(orders.map((o) => o.conversation_id))),
    teamMemberNames(supabase, uniq(orders.map((o) => o.updated_by))),
  ]);

  return orders.map((o) => {
    const driver = o.driver_id ? drivers.get(o.driver_id) : undefined;
    const customer = customers.get(o.conversation_id);
    return {
      ...o,
      specialist_name: (o.specialist_id && specialists.get(o.specialist_id)?.fullName) || null,
      driver_name: driver?.fullName ?? null,
      driver_phone: driver?.phone ?? null,
      customer_name: customer?.name ?? null,
      updated_by_name: (o.updated_by && editors.get(o.updated_by)) || null,
      specialist_session: fieldSessionStateOf(
        customer?.metadata ?? null,
        o.id,
        "specialist"
      ),
      driver_session: fieldSessionStateOf(
        customer?.metadata ?? null,
        o.id,
        "driver"
      ),
    };
  });
}

/** Team-member display names, for "عُدّل بواسطة …". */
async function teamMemberNames(
  supabase: AuthedClient,
  ids: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const { data } = await supabase
    .from("team_members")
    .select("id, full_name")
    .in("id", ids);
  for (const row of data ?? []) {
    if (row.full_name) out.set(row.id as string, row.full_name as string);
  }
  return out;
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

async function customerDetails(
  supabase: AuthedClient,
  ids: string[]
): Promise<
  Map<string, { name: string | null; metadata: Record<string, unknown> | null }>
> {
  if (!ids.length) return new Map();
  const { data } = await supabase
    .from("conversations")
    .select("id, customer_name, metadata")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .in("id", ids);
  return new Map(
    (data ?? []).map((r) => [
      r.id as string,
      {
        name: (r.customer_name as string | null) ?? null,
        metadata: (r.metadata as Record<string, unknown> | null) ?? null,
      },
    ])
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
  sessionLink?: string | null;
}): string {
  const arrival = ARRIVAL_FMT.format(new Date(o.arrivalAt));
  const who = o.customerName ? `${o.customerName} (${o.customerPhone})` : o.customerPhone;
  const lines = [
    "🚗 *طلب جديد*",
    "",
    `👩 الأخصائية: ${o.specialistName}`,
    `🕒 موعد الوصول: ${arrival}`,
    `⏱️ مدة الجلسة: ${formatDuration(o.durationMinutes)}`,
    `🚕 نوع الرحلة: ${TRIP_TYPE_LABEL[o.tripType]}`,
    `📍 موقع الزبونة: ${o.customerLocation}`,
    `📞 رقم الزبونة: ${who}`,
  ];
  if (o.sessionLink) {
    lines.push("", "📲 جلساتك وتأكيد البداية والنهاية:", o.sessionLink);
  }
  return lines.join("\n");
}

/**
 * The specialist's copy of the order — written in Arabic and translated to her
 * mother language before sending (see dispatchBooking). No price: like
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
  sessionLink?: string | null;
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
  if (o.sessionLink) {
    lines.push("", "📲 جلساتك وتأكيد البداية والنهاية:", o.sessionLink);
  }
  return lines.join("\n");
}
