/**
 * Driver dispatch: the specialists + drivers rosters and the order that lands
 * in the field team's app. Nothing is sent to a driver's or a specialist's
 * WhatsApp — the assignment, its note and its voice note live on the order and
 * are read back by the app, with a push notification as the nudge. All
 * reads/writes go through the RLS-respecting
 * authed client and are pinned to Kiara's tenant (RLS enforces it too). Roster
 * writes are additionally gated to admins by the API routes.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { formatDuration, TRIP_TYPE_LABEL } from "@/lib/format";
import { fieldSessionStateOf } from "@/lib/field-session";
import { ensureFieldOrderProgress } from "@/lib/field-staff";
import { notifyFieldOrderAssigned } from "@/lib/field-push";
import { findSharedLocationInConversation } from "@/lib/location";
import { nationalityOf } from "@/lib/nationalities";
import { normalizePhone } from "@/lib/phone";
import {
  finishOrderDispatchCommand,
  prepareOrderDispatchCommand,
  updateOrderCommand,
  type OperationsActor,
} from "@/lib/operational-commands";
import { findOrCreateConversation } from "@/lib/server-conversations";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import { translateMessage } from "@/lib/translate";
import { uploadBase64Media } from "@/lib/storage-media";
import type {
  Specialist,
  Driver,
  DriverOrder,
  DriverOrderRow,
  DispatchSettings,
  FieldOrderProgressState,
  TripType,
} from "@/lib/types";

type AuthedClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

const SPECIALIST_COLS = "id, full_name, phone, is_active, nationality";
/** Until the nationality migration runs, reads fall back to these columns. */
const LEGACY_SPECIALIST_COLS = "id, full_name, phone, is_active";
const missingNationality = (err: { message: string } | null) =>
  Boolean(err?.message.includes("nationality"));
const NATIONALITY_SCHEMA_ERROR =
  "تحديث الجنسيات غير مطبّق على قاعدة البيانات. تواصلي مع مسؤول النظام ثم أعيدي المحاولة.";
const DRIVER_COLS = "id, full_name, phone, is_active";
/**
 * The columns that existed before the operational command migration. Kept as
 * the floor of the fallback ladder so a deploy that lands ahead of its
 * migration degrades instead of blanking the orders screen — which is exactly
 * what happened: every mobile calendar request died on `driver_orders.version
 * does not exist`, and the employee saw only "تعذر تحميل البيانات".
 */
const ORDER_COLS_LEGACY =
  "id, conversation_id, specialist_id, driver_id, arrival_at, customer_location, customer_phone, duration_minutes, trip_type, price, status, sent_at, created_at, updated_at";
const ORDER_COLS = `${ORDER_COLS_LEGACY}, version, dispatch_state, active_dispatch_command_id, dispatch_started_at`;
/** Adds the editor. Falls back to ORDER_COLS until that migration runs. */
const ORDER_COLS_WITH_EDITOR = `${ORDER_COLS}, updated_by`;
/** Adds the Rekaz link. Falls back again until 20260811194500 runs. */
const ORDER_COLS_WITH_REKAZ = `${ORDER_COLS_WITH_EDITOR}, rekaz_source_id`;
/** Adds the app-only dispatch notes. Falls back until 20260902100000 runs. */
const ORDER_COLS_WITH_NOTES = `${ORDER_COLS_WITH_REKAZ}, driver_note, specialist_note, specialist_voice_path`;
const missingUpdatedBy = (err: { message: string } | null) =>
  Boolean(err?.message.includes("updated_by"));
const missingRekazLink = (err: { message: string } | null) =>
  Boolean(err?.message.includes("rekaz_source_id"));
const missingDispatchNotes = (err: { message: string } | null) =>
  Boolean(
    err?.message.includes("driver_note") ||
      err?.message.includes("specialist_note") ||
      err?.message.includes("specialist_voice_path"),
  );
const missingOperationalColumns = (err: { message: string } | null) =>
  Boolean(
    err?.message.includes("version") ||
      err?.message.includes("dispatch_state") ||
      err?.message.includes("active_dispatch_command_id") ||
      err?.message.includes("dispatch_started_at"),
  );

/**
 * Fill in what the un-migrated database cannot answer.
 *
 * `version` is deliberately 0 rather than 1: every command compares against a
 * real stored version, so a synthesized value must never look like one an
 * employee could successfully submit. Reads render; writes still fail loudly
 * until the migration lands.
 */
function withLegacyOperationalDefaults(rows: DriverOrder[]): DriverOrder[] {
  return rows.map((row) => ({
    ...row,
    version: 0,
    dispatch_state:
      row.status === "sent" ? "sent" : row.status === "failed" ? "failed" : "idle",
    active_dispatch_command_id: null,
    dispatch_started_at: null,
  }));
}

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
  if (missingNationality(error)) {
    // Creating without a nationality can remain compatible with an older
    // schema. If one was chosen, retrying without it would discard the value
    // while falsely reporting a successful save.
    if (nationality) throw new Error(NATIONALITY_SCHEMA_ERROR);
    ({ data, error } = await insert(false));
  }
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
    // Never report success after removing a field the employee explicitly
    // changed. This was why nationality disappeared when the row re-rendered.
    if (patch.nationality !== undefined) {
      throw new Error(NATIONALITY_SCHEMA_ERROR);
    }
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

/** All staff WhatsApp numbers that must never be treated as customer chats. */
export async function listRosterContactPhones(): Promise<string[]> {
  const [specialists, drivers] = await Promise.all([
    listSpecialists(),
    listDrivers(),
  ]);
  return [
    ...new Set(
      [...specialists.map((item) => item.phone), ...drivers.map((item) => item.phone)]
        .map((phone) => phone?.trim() ?? "")
        .filter(Boolean)
    ),
  ];
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

export class RekazBookingError extends Error {
  constructor(public readonly code:
    | "RESERVATION_NOT_FOUND"
    | "RESERVATION_CANCELLED"
    | "CUSTOMER_PHONE_INVALID"
    | "ORDER_ALREADY_LINKED"
    | "REKAZ_LINK_UNAVAILABLE") {
    super(code);
    this.name = "RekazBookingError";
  }
}

/**
 * Raise the operational order for a Rekaz visit that has none yet.
 *
 * The reservation is read from the normalized `rekaz_reservations` rows rather
 * than from the client, so arrival time, duration and address are the synced
 * values and not something a phone could invent. The order carries the Rekaz
 * source id, which is what later lets the calendar merge the two sides exactly.
 *
 * Creation is deliberately separate from dispatch: this only produces the
 * pending visit. Choosing a specialist and driver still goes through the
 * dispatch preview, where the employee sees and edits the exact messages.
 */
/**
 * Arrival to end for every service booked under one Rekaz order, falling back
 * to the single reservation when it carries no order id (or when the lookup
 * turns up nothing, which must never block raising the order).
 */
async function rekazVisitSpan(
  admin: ReturnType<typeof getAdminSupabaseClient>,
  orderId: string,
  arrivalAt: string,
  durationMinutes: number
): Promise<{ startsAt: string; minutes: number }> {
  const own = Number.isFinite(durationMinutes) && durationMinutes > 0
    ? durationMinutes
    : 60;
  const alone = { startsAt: arrivalAt, minutes: own };
  if (!orderId) return alone;

  const { data } = await admin
    .from("rekaz_reservations")
    .select("arrival_at, payload, status, removed_at")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .is("removed_at", null)
    .filter("payload->order->>id", "eq", orderId);
  if (!data?.length) return alone;

  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const row of data) {
    if (row.status === "Cancelled") continue;
    const from = Date.parse(String(row.arrival_at));
    if (!Number.isFinite(from)) continue;
    const minutes =
      Number((row.payload as { durationMinutes?: number } | null)?.durationMinutes) || 0;
    start = Math.min(start, from);
    end = Math.max(end, from + Math.max(minutes, 0) * 60_000);
  }
  if (!Number.isFinite(start) || end <= start) return alone;

  return {
    startsAt: new Date(start).toISOString(),
    minutes: Math.round((end - start) / 60_000),
  };
}

export async function createBookingFromReservation(
  userId: string,
  sourceId: string
): Promise<DriverOrder> {
  const admin = getAdminSupabaseClient();

  const { data: reservation, error: resErr } = await admin
    .from("rekaz_reservations")
    .select(
      "source_id, arrival_at, customer_phone, customer_name, status, payload, removed_at",
    )
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .eq("source_id", sourceId)
    .maybeSingle();
  if (resErr) throw new Error(resErr.message);
  if (!reservation || reservation.removed_at) {
    throw new RekazBookingError("RESERVATION_NOT_FOUND");
  }
  if (reservation.status === "Cancelled") {
    throw new RekazBookingError("RESERVATION_CANCELLED");
  }

  const payload = (reservation.payload ?? {}) as {
    durationMinutes?: number;
    location?: { label?: string; lat?: number; lng?: number } | null;
    service?: string;
    order?: { id?: string } | null;
  };
  const phone = String(reservation.customer_phone ?? "");

  // Several services booked together are one visit and share one Rekaz order
  // id. The driver is planned around the whole stay, so the order spans from
  // the first service's arrival to the last one's end — booking only the
  // service that happened to be tapped would send the car back an hour early.
  const visit = await rekazVisitSpan(
    admin,
    payload.order?.id?.trim() ?? "",
    String(reservation.arrival_at),
    Number(payload.durationMinutes)
  );

  // Every order still hangs off a conversation, but a Rekaz booking is not
  // allowed to depend on one already existing: raising the visit is an
  // operational act, and the customer may never have written on WhatsApp.
  //
  // The match is on the national part rather than the stored string. Threads
  // are kept as `+9665…` while Rekaz hands back anything from `05…` to bare
  // digits, and the previous exact comparison normalized one side only — so it
  // matched nothing at all, and even customers with a live chat were turned
  // away with "لا توجد محادثة واتساب بهذا الرقم".
  const national = normalizePhone(phone);
  if (!national) throw new RekazBookingError("CUSTOMER_PHONE_INVALID");
  const { data: matched, error: convErr } = await admin
    .from("conversations")
    .select("id, customer_phone")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .ilike("customer_phone", `%${national}%`)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (convErr) throw new Error(convErr.message);

  // No thread yet: open an empty one under her Rekaz name, exactly as the web
  // schedule's طلب سائق already does. The salon writes to her from it later
  // — the order is not held up waiting for her to message first.
  const conversation =
    matched ??
    {
      id: (
        await findOrCreateConversation(
          phone,
          String(reservation.customer_name ?? "").trim() || null,
        )
      ).id,
      customer_phone: phone,
    };

  // Where she actually is — never what she booked.
  //
  // This used to fall back to the service name, and since almost no Rekaz
  // booking carries a location that is what nearly every raised order got:
  // "📍 موقع الزبونة: مساج اخشاب 60د" went out to the driver over WhatsApp as
  // if it were an address. Rekaz's own labels are no better on their own —
  // "المنزل", "الشقه رقم واحد" — so the coordinates beside them, which this
  // code used to discard, are the part that gets a car to the door.
  const location =
    rekazLocationValue(payload.location) ??
    (await findSharedLocationInConversation(admin, conversation.id))?.value ??
    LOCATION_UNSET;
  const durationMinutes = Math.min(Math.max(visit.minutes, 5), 480);

  const { data: created, error: insErr } = await admin
    .from("driver_orders")
    .insert({
      restaurant_id: KIARA_RESTAURANT_ID,
      conversation_id: conversation.id,
      specialist_id: null,
      driver_id: null,
      arrival_at: visit.startsAt,
      customer_location: location,
      customer_phone: conversation.customer_phone as string,
      duration_minutes: durationMinutes,
      trip_type: "one_way",
      price: null,
      status: "pending",
      created_by: userId,
      rekaz_source_id: sourceId,
    })
    .select(ORDER_COLS_WITH_REKAZ)
    .single();

  if (insErr) {
    // The partial unique index is the race barrier: two employees tapping
    // "طلب سائق" on the same visit produce one order, not two.
    if (insErr.code === "23505") throw new RekazBookingError("ORDER_ALREADY_LINKED");
    if (missingRekazLink(insErr)) throw new RekazBookingError("REKAZ_LINK_UNAVAILABLE");
    throw new Error(insErr.message);
  }

  await clearBookingRequest(conversation.id).catch(() => {});
  return created as unknown as DriverOrder;
}

/**
 * What the order says when nobody has given us an address yet.
 *
 * Deliberately not "—": this text reaches the employee on the order screen and
 * the driver in the dispatch message, and it has to read as a missing field
 * she must fill, not as a place.
 */
export const LOCATION_UNSET = "لم يُحدد الموقع — حدّديه قبل الإرسال";

/**
 * A Rekaz booking's location as one line: her label plus a maps link built
 * from the coordinates, in the "label — url" shape the rest of the app already
 * uses for a location shared over WhatsApp.
 */
function rekazLocationValue(
  location: { label?: string; lat?: number; lng?: number } | null | undefined,
): string | null {
  if (!location) return null;
  const label = location.label?.trim() ?? "";
  const url =
    Number.isFinite(location.lat) && Number.isFinite(location.lng)
      ? `https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}`
      : null;
  return [label, url].filter(Boolean).join(" — ") || null;
}

export interface DispatchBookingInput {
  specialistId: string;
  driverId: string;
  /** Exact final note bodies confirmed by the employee, as the app shows them. */
  driverMessage: string;
  specialistMessage: string;
  expectedVersion: number;
  idempotencyKey: string;
  actor: OperationsActor;
  /** Rekaz does not carry this dispatch-only choice. */
  tripType?: TripType;
  /** Optional staff note included in the translated specialist message. */
  specialistNote?: string;
  /**
   * A recorded note for the specialist, stored alongside her written one and
   * played back inside her app. Some things are faster said than typed — and a
   * specialist who reads little Arabic follows a voice far better than text.
   */
  specialistVoice?: {
    base64: string;
    contentType: string;
    filename?: string | null;
  };
}

export interface DispatchPreviewInput {
  specialistId: string;
  driverId: string;
  tripType?: TripType;
  specialistNote?: string;
  driverMessage?: string;
}

export interface DispatchPreview {
  driverMessage: string;
  specialistMessage: string;
  specialistLanguage: string;
  automaticAdditions: string[];
}

/**
 * Does this order exist for the tenant?
 *
 * This is the whole authorization rule for acting on an order. Orders used to
 * be gated on the conversation behind them, which meant a chat routed to one
 * employee took her visits out of everyone else's schedule — including the
 * colleague covering her shift. Reading a chat is hers; the driver run is the
 * floor's.
 */
export async function orderExists(id: string): Promise<boolean> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("driver_orders")
    .select("id")
    .eq("id", id)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

/** The conversation an order hangs off, for the surfaces that read the chat
 * itself rather than the operational row. */
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
 * Assign a specialist and driver to an existing booking and attach both notes.
 * The specialist's copy is translated to her mother language when configured;
 * the driver's is the dispatch copy. Both are read in the app, not sent.
 */
type DispatchContext = {
  order: DriverOrder;
  tripType: TripType;
  price: number | null;
  specialist: {
    id: string;
    full_name: string;
    phone: string | null;
    nationality?: string | null;
  };
  driver: { id: string; full_name: string; phone: string | null };
  customerName: string | null;
};

async function loadDispatchContext(
  id: string,
  input: Pick<DispatchPreviewInput, "specialistId" | "driverId" | "tripType">,
): Promise<DispatchContext> {
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
  if (order.status === "sent" || order.dispatch_state === "sent") {
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
  // A phone is the driver's app login, not a delivery address any more, so a
  // roster row without one still dispatches.
  if (!driver) throw new Error("Driver not found");
  if (!conv) throw new Error("Conversation not found");

  return {
    order,
    tripType,
    price,
    specialist,
    driver: driver as { id: string; full_name: string; phone: string | null },
    customerName: (conv.customer_name as string | null) ?? null,
  };
}

export async function previewBookingDispatch(
  id: string,
  input: DispatchPreviewInput,
): Promise<DispatchPreview> {
  const context = await loadDispatchContext(id, input);
  const orderDetails = {
    specialistName: context.specialist.full_name,
    arrivalAt: context.order.arrival_at,
    durationMinutes: context.order.duration_minutes,
    customerLocation: context.order.customer_location,
    customerName: context.customerName,
    customerPhone: context.order.customer_phone,
    tripType: context.tripType,
  };
  // No "open the Kiara app" footer any more: this text is only ever read
  // inside the app, so the line told the reader to open what they had open.
  const driverMessage =
    input.driverMessage?.trim().slice(0, 3000) ||
    formatDriverOrderMessage(orderDetails);
  const arabicSpecialistMessage = formatSpecialistOrderMessage({
    ...orderDetails,
    driverName: context.driver.full_name,
    note: input.specialistNote?.trim() || null,
    sessionLink: null,
  });
  const nationality = nationalityOf(context.specialist.nationality);
  const translated = nationality?.targetLanguage
    ? await translateMessage(arabicSpecialistMessage, nationality.targetLanguage)
    : null;

  return {
    driverMessage,
    specialistMessage: translated || arabicSpecialistMessage,
    // Name the language of the text actually produced. Reporting her mother
    // tongue while handing back the Arabic fallback told the employee the
    // translation had happened when it had not — she would send it believing
    // the specialist could read it.
    specialistLanguage: translated
      ? (nationality?.languageLabel ?? "العربية")
      : "العربية",
    automaticAdditions: [],
  };
}

/**
 * Attach the assignment to the order, then tell the field team's phones.
 *
 * The command writes the assignment and both notes in one statement, so the
 * moment an order is dispatched it is already complete in the app. The push is
 * a nudge on top of that, never the delivery itself: a phone with notifications
 * off or a stale token must not make the order look failed, because the driver
 * will still find it when he next opens his list.
 */
export async function dispatchBooking(
  id: string,
  input: DispatchBookingInput
): Promise<{
  order: DriverOrderRow;
  sent: boolean;
  specialistSent: boolean | null;
  /** Did at least one device accept the nudge? Reported, never fatal. */
  notified: boolean;
}> {
  const context = await loadDispatchContext(id, input);
  const specialistMessage = input.specialistMessage.trim();

  // Uploaded before the command so the note and its recording commit together;
  // a failed upload costs the recording, not the dispatch.
  let specialistVoicePath: string | null = null;
  if (input.specialistVoice) {
    const stored = await uploadBase64Media({
      restaurantId: KIARA_RESTAURANT_ID,
      conversationId: context.order.conversation_id,
      contentType: input.specialistVoice.contentType,
      base64: input.specialistVoice.base64,
      originalFilename: input.specialistVoice.filename ?? null,
    });
    specialistVoicePath = stored.storage_path;
  }

  const prepared = await prepareOrderDispatchCommand({
    restaurantId: KIARA_RESTAURANT_ID,
    orderId: id,
    expectedVersion: input.expectedVersion,
    idempotencyKey: input.idempotencyKey,
    actor: input.actor,
    specialistId: input.specialistId,
    driverId: input.driverId,
    tripType: context.tripType,
    price: context.price,
    driverNote: input.driverMessage.trim(),
    specialistNote: specialistMessage,
    specialistVoicePath,
  });
  const commandId = String(prepared.commandId);

  await ensureFieldOrderProgress(id).catch(() => undefined);

  const push = await notifyFieldOrderAssigned({
    orderId: id,
    customerName: context.customerName,
    specialistId: input.specialistId,
    driverId: input.driverId,
  }).catch(() => null);

  const finished = await finishOrderDispatchCommand({
    restaurantId: KIARA_RESTAURANT_ID,
    orderId: id,
    commandId,
    driverSent: true,
    specialistSent: Boolean(specialistMessage),
    driverError: null,
    specialistError: null,
  });
  const raw = finished.order;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("تعذّر قراءة الطلب بعد الإرسال");
  }
  const [enriched] = await withNames(await createServerSupabaseClient(), [
    raw as unknown as DriverOrder,
  ]);
  return {
    order: enriched,
    sent: true,
    specialistSent: specialistMessage ? true : null,
    notified: Boolean(push && push.accepted > 0),
  };
}

/** Drop the bot-collected booking_request flag from a conversation, if any. */
export async function clearBookingRequest(conversationId: string): Promise<void> {
  const admin = getAdminSupabaseClient();
  const { data: conv, error: readError } = await admin
    .from("conversations")
    .select("metadata")
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  const metadata = (conv?.metadata as Record<string, unknown> | null) ?? null;
  if (!metadata || !("booking_request" in metadata)) return;
  const rest = { ...metadata };
  delete rest.booking_request;
  const { error } = await admin
    .from("conversations")
    .update({ metadata: rest })
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID);
  if (error) throw new Error(error.message);
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

/**
 * Run a `driver_orders` read down the column ladder, then resolve names.
 *
 * The ladder is the deploy-ahead-of-migration guard described at ORDER_COLS;
 * every read needs it, so it lives here once rather than being copied into
 * each caller.
 */
async function readOrders(
  supabase: AuthedClient,
  build: (cols: string) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<DriverOrderRow[]> {
  let { data, error } = await build(ORDER_COLS_WITH_NOTES);
  if (error && missingDispatchNotes(error)) {
    ({ data, error } = await build(ORDER_COLS_WITH_REKAZ));
  }
  if (error && missingRekazLink(error)) {
    ({ data, error } = await build(ORDER_COLS_WITH_EDITOR));
  }
  if (error && missingUpdatedBy(error)) ({ data, error } = await build(ORDER_COLS));
  if (error && missingOperationalColumns(error)) {
    ({ data, error } = await build(ORDER_COLS_LEGACY));
    if (error) throw new Error(error.message);
    return withNames(
      supabase,
      withLegacyOperationalDefaults((data ?? []) as DriverOrder[]),
    );
  }
  if (error) throw new Error(error.message);
  return withNames(supabase, (data ?? []) as DriverOrder[]);
}

export interface DriverOrderQuery {
  limit?: number;
  /** Inclusive arrival window. The calendar asks for a week, not for "the
   * newest 200 rows, most of which it will discard". */
  from?: string;
  to?: string;
}

/** Newest-arrival-first orders for the /orders view, with names resolved. */
export async function listDriverOrders(
  options: number | DriverOrderQuery = 200,
): Promise<DriverOrderRow[]> {
  const { limit = 200, from, to } =
    typeof options === "number" ? { limit: options } : options;
  const supabase = await createServerSupabaseClient();
  return readOrders(supabase, (cols) => {
    let query = supabase
      .from("driver_orders")
      .select(cols)
      .eq("restaurant_id", KIARA_RESTAURANT_ID);
    if (from) query = query.gte("arrival_at", from);
    if (to) query = query.lte("arrival_at", to);
    return query.order("arrival_at", { ascending: false }).limit(limit);
  });
}

/**
 * One enriched order.
 *
 * Worth its own read: resolving a single order by scanning the newest
 * thousand and enriching every one of them cost five queries and grew with
 * the salon's history, on the path that opens the dispatch modal.
 */
export async function getDriverOrderById(
  id: string,
): Promise<DriverOrderRow | null> {
  const supabase = await createServerSupabaseClient();
  const [row] = await readOrders(supabase, (cols) =>
    supabase
      .from("driver_orders")
      .select(cols)
      .eq("id", id)
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .limit(1),
  );
  return row ?? null;
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
  command: {
    expectedVersion: number;
    idempotencyKey: string;
    actor: OperationsActor;
  },
): Promise<DriverOrderRow> {
  const supabase = await createServerSupabaseClient();
  const result = await updateOrderCommand({
    restaurantId: KIARA_RESTAURANT_ID,
    orderId: id,
    expectedVersion: command.expectedVersion,
    idempotencyKey: command.idempotencyKey,
    actor: command.actor,
    patch: { ...patch },
  });
  const data = result.order;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("تعذّر قراءة الطلب بعد التحديث");
  }

  const [row] = await withNames(supabase, [data as unknown as DriverOrder]);
  return row;
}

/**
 * Nudge the field team about an order they already have — the recovery path for
 * a phone that never showed the notification (app closed on install, token
 * refreshed, notifications off at the time).
 *
 * It re-sends the push only. The order itself, with its notes, has been in both
 * their apps since dispatch, so nothing is rebuilt and the row's
 * status/sent_at are left exactly as the dispatch left them.
 */
export async function resendDriverOrder(
  id: string
): Promise<{ order: DriverOrderRow; sent: boolean }> {
  const supabase = await createServerSupabaseClient();

  const [row] = await readOrders(supabase, (cols) =>
    supabase
      .from("driver_orders")
      .select(cols)
      .eq("id", id)
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .limit(1),
  );
  if (!row) throw new Error("الطلب غير موجود");
  if (!row.driver_id) throw new Error("لا يوجد سائق مرتبط بهذا الطلب");
  if (!row.specialist_id) throw new Error("لا توجد أخصائية مرتبطة بهذا الطلب");

  const push = await notifyFieldOrderAssigned({
    orderId: row.id,
    customerName: row.customer_name ?? null,
    specialistId: row.specialist_id,
    driverId: row.driver_id,
    repeat: true,
  }).catch(() => null);

  return { order: row, sent: Boolean(push && push.accepted > 0) };
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

  const [specialists, drivers, customers, editors, progress] = await Promise.all([
    rosterNames(supabase, "specialists", uniq(orders.map((o) => o.specialist_id))),
    rosterNames(supabase, "drivers", uniq(orders.map((o) => o.driver_id))),
    customerDetails(supabase, uniq(orders.map((o) => o.conversation_id))),
    teamMemberNames(supabase, uniq(orders.map((o) => o.updated_by))),
    fieldProgressFor(orders.map((o) => o.id)),
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
      field_progress: progress.get(o.id) ?? null,
    };
  });
}

/**
 * The in-app step machine for a page of orders.
 *
 * Read with the admin client on purpose: `field_order_progress` is revoked
 * from `authenticated` — only the field app's service-role routes write it —
 * so the RLS client used for the rest of the enrichment would come back empty
 * rather than forbidden, which is the worse failure. The rows are operational
 * timestamps, no different in sensitivity from the schedule itself, and the
 * orders list is already visible to every employee.
 *
 * A failure here never fails the read: an order with no progress row (never
 * dispatched) and an unreadable table both render as "not started".
 */
async function fieldProgressFor(
  orderIds: string[]
): Promise<Map<string, FieldOrderProgressState>> {
  const out = new Map<string, FieldOrderProgressState>();
  if (!orderIds.length) return out;
  // getAdminSupabaseClient() throws outright when the service key is absent,
  // and the query throws on a table an older database does not have yet.
  // Either would take the whole orders screen down over a decoration.
  let data: Record<string, unknown>[] | null = null;
  try {
    const result = await getAdminSupabaseClient()
      .from("field_order_progress")
      .select("*")
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .in("order_id", orderIds);
    if (result.error) return out;
    data = result.data as Record<string, unknown>[] | null;
  } catch {
    return out;
  }
  if (!data) return out;
  for (const row of data) {
    out.set(row.order_id as string, {
      driverConfirmedAt: (row.driver_confirmed_at as string | null) ?? null,
      driverArrivedAt: (row.driver_arrived_at as string | null) ?? null,
      specialistPickupAt: (row.specialist_pickup_at as string | null) ?? null,
      serviceStartedAt: (row.service_started_at as string | null) ?? null,
      completedAt: (row.completed_at as string | null) ?? null,
      driverReturnedAt: (row.driver_returned_at as string | null) ?? null,
      lastActivityAt:
        (row.last_activity_at as string | null) ?? new Date().toISOString(),
      lastReminderAt: (row.last_reminder_at as string | null) ?? null,
      version: Number(row.version ?? 1),
    });
  }
  return out;
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
