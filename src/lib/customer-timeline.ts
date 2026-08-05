/**
 * One customer, everything in one place — keyed on her phone number.
 *
 * There is no `customers` table in this app: a customer is her phone, and her
 * story is scattered across three systems — the WhatsApp thread (first contact,
 * messages, staff notes) and driver dispatch live here in Supabase, while every
 * booking, the specialist who served her, and what she paid live in Rekaz. This
 * module stitches them into one chronological timeline plus a lifetime-revenue
 * header, so the salon can see a customer whole without hopping between screens.
 *
 * Rekaz is the source of truth for bookings and money; this app owns the
 * relationship layer Rekaz doesn't expose. Phone is the only join key, matched
 * on the national part so +966 / 05x / bare-digits variants all resolve.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import { normalizePhone } from "@/lib/phone";
import { fetchCustomerReservations, type CustomerRevenue } from "@/lib/rekaz";
import type { RekazReservation } from "@/lib/reservations";

/** Recent messages pulled into the timeline; the rest stay in the inbox. */
const MESSAGE_LIMIT = 40;

export interface TimelineCustomer {
  phone: string; // E.164 as passed in
  name: string | null;
  conversationId: string | null;
  firstContactAt: string | null; // conversation.started_at
  lastActivityAt: string | null; // conversation.last_message_at
  labels: { name: string; color: string }[];
}

export interface TimelineRevenue extends CustomerRevenue {
  bookings: number; // lifetime reservation count (all statuses)
  cancelled: number; // of those, how many were cancelled
}

export type TimelineEvent =
  | { kind: "contact"; at: string }
  | {
      kind: "message";
      at: string;
      role: "customer" | "agent" | "system";
      content: string;
      messageType: string;
      hasMedia: boolean;
    }
  | {
      kind: "booking";
      at: string;
      id: string;
      service: string;
      providers: string[];
      status: string;
      payment: string;
      amount: number;
      source: string;
      location: RekazReservation["location"];
    }
  | {
      kind: "driver";
      at: string;
      status: string;
      driverName: string | null;
      specialistName: string | null;
      tripType: string;
    }
  | { kind: "note"; at: string; body: string; author: string | null };

export interface CustomerTimeline {
  customer: TimelineCustomer;
  revenue: TimelineRevenue;
  events: TimelineEvent[]; // newest first
  messagesShown: number;
  messagesTotal: number;
  /** True when the Rekaz lookup failed — the app half still renders. */
  rekazError: boolean;
}

export async function getCustomerTimeline(phone: string): Promise<CustomerTimeline> {
  const admin = getAdminSupabaseClient();
  const national = normalizePhone(phone);

  // The conversation is the customer record. Match on the national part so a
  // thread stored as +9665… still answers a lookup for 05… or bare digits.
  const { data: conversation } = await admin
    .from("conversations")
    .select("id, customer_name, customer_phone, started_at, last_message_at")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .ilike("customer_phone", `%${national}%`)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const conversationId = (conversation?.id as string) ?? null;

  // Everything that depends on the thread, plus Rekaz, runs together.
  const [messagesResult, driverOrders, notes, labels, rekaz] = await Promise.all([
    conversationId ? fetchMessages(conversationId) : Promise.resolve({ rows: [], total: 0 }),
    fetchDriverOrders(conversationId, national),
    conversationId ? fetchNotes(conversationId) : Promise.resolve([]),
    conversationId ? fetchLabels(conversationId) : Promise.resolve([]),
    fetchCustomerReservations(phone).catch(() => null),
  ]);

  const events: TimelineEvent[] = [];

  if (conversation?.started_at) {
    events.push({ kind: "contact", at: conversation.started_at as string });
  }

  for (const m of messagesResult.rows) {
    events.push({
      kind: "message",
      at: m.created_at,
      role: m.role,
      content: m.content ?? "",
      messageType: m.message_type ?? "text",
      hasMedia: Array.isArray((m.metadata as { media?: unknown[] } | null)?.media)
        ? ((m.metadata as { media?: unknown[] }).media?.length ?? 0) > 0
        : false,
    });
  }

  for (const r of rekaz?.reservations ?? []) {
    events.push({
      kind: "booking",
      at: r.arrivalAt,
      id: r.id,
      service: r.service,
      providers: r.providers,
      status: r.status,
      payment: r.payment,
      amount: r.amount,
      source: r.source,
      location: r.location,
    });
  }

  for (const o of driverOrders) {
    events.push({
      kind: "driver",
      at: o.sent_at ?? o.arrival_at ?? o.created_at,
      status: o.status,
      driverName: o.driverName,
      specialistName: o.specialistName,
      tripType: o.trip_type,
    });
  }

  for (const n of notes) {
    events.push({ kind: "note", at: n.created_at, body: n.body, author: n.author });
  }

  // Newest first. Ties broken so the first-contact marker sits below the first
  // message of the same instant rather than above it.
  events.sort((a, b) => {
    const cmp = b.at.localeCompare(a.at);
    if (cmp !== 0) return cmp;
    return (a.kind === "contact" ? 1 : 0) - (b.kind === "contact" ? 1 : 0);
  });

  const reservations = rekaz?.reservations ?? [];
  return {
    customer: {
      phone,
      name: (conversation?.customer_name as string) ?? reservations[0]?.customerName ?? null,
      conversationId,
      firstContactAt: (conversation?.started_at as string) ?? null,
      lastActivityAt: (conversation?.last_message_at as string) ?? null,
      labels,
    },
    revenue: {
      ...(rekaz?.revenue ?? { net: 0, booked: 0, refunded: 0, orders: 0 }),
      bookings: reservations.length,
      cancelled: reservations.filter((r) => r.status === "Cancelled").length,
    },
    events,
    messagesShown: messagesResult.rows.length,
    messagesTotal: messagesResult.total,
    rekazError: rekaz === null,
  };
}

interface MessageRow {
  role: "customer" | "agent" | "system";
  content: string | null;
  message_type: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

async function fetchMessages(
  conversationId: string
): Promise<{ rows: MessageRow[]; total: number }> {
  const admin = getAdminSupabaseClient();
  const [{ data }, { count }] = await Promise.all([
    admin
      .from("messages")
      .select("role, content, message_type, metadata, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(MESSAGE_LIMIT),
    admin
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversationId),
  ]);
  return { rows: (data ?? []) as MessageRow[], total: count ?? 0 };
}

interface DriverOrderLite {
  arrival_at: string;
  sent_at: string | null;
  created_at: string;
  status: string;
  trip_type: string;
  driverName: string | null;
  specialistName: string | null;
}

/**
 * Her driver trips, by thread when we have one and by the phone snapshotted on
 * the order otherwise. Names are resolved in one small pair of queries.
 */
async function fetchDriverOrders(
  conversationId: string | null,
  national: string
): Promise<DriverOrderLite[]> {
  const admin = getAdminSupabaseClient();
  let query = admin
    .from("driver_orders")
    .select("arrival_at, sent_at, created_at, status, trip_type, specialist_id, driver_id")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .order("arrival_at", { ascending: false });
  query = conversationId
    ? query.eq("conversation_id", conversationId)
    : query.ilike("customer_phone", `%${national}%`);

  const { data } = await query;
  const rows = (data ?? []) as {
    arrival_at: string;
    sent_at: string | null;
    created_at: string;
    status: string;
    trip_type: string;
    specialist_id: string | null;
    driver_id: string | null;
  }[];
  if (!rows.length) return [];

  const specialistIds = [...new Set(rows.map((r) => r.specialist_id).filter(Boolean))] as string[];
  const driverIds = [...new Set(rows.map((r) => r.driver_id).filter(Boolean))] as string[];
  const [specialists, drivers] = await Promise.all([
    rosterNames("specialists", specialistIds),
    rosterNames("drivers", driverIds),
  ]);

  return rows.map((r) => ({
    arrival_at: r.arrival_at,
    sent_at: r.sent_at,
    created_at: r.created_at,
    status: r.status,
    trip_type: r.trip_type,
    driverName: r.driver_id ? drivers.get(r.driver_id) ?? null : null,
    specialistName: r.specialist_id ? specialists.get(r.specialist_id) ?? null : null,
  }));
}

async function rosterNames(
  table: "specialists" | "drivers",
  ids: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const { data } = await getAdminSupabaseClient()
    .from(table)
    .select("id, full_name")
    .in("id", ids);
  for (const row of data ?? []) {
    if (row.full_name) out.set(row.id as string, row.full_name as string);
  }
  return out;
}

async function fetchNotes(
  conversationId: string
): Promise<{ created_at: string; body: string; author: string | null }[]> {
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("conversation_internal_notes")
    .select("body, created_at, author_user_id")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as { body: string; created_at: string; author_user_id: string | null }[];
  if (!rows.length) return [];

  const authorIds = [...new Set(rows.map((r) => r.author_user_id).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (authorIds.length) {
    const { data: members } = await admin
      .from("team_members")
      .select("user_id, full_name")
      .in("user_id", authorIds);
    for (const m of members ?? []) {
      if (m.full_name) names.set(m.user_id as string, m.full_name as string);
    }
  }
  return rows.map((r) => ({
    created_at: r.created_at,
    body: r.body,
    author: r.author_user_id ? names.get(r.author_user_id) ?? null : null,
  }));
}

async function fetchLabels(
  conversationId: string
): Promise<{ name: string; color: string }[]> {
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("conversation_label_assignments")
    .select("conversation_labels(name, color)")
    .eq("conversation_id", conversationId);
  const out: { name: string; color: string }[] = [];
  // PostgREST returns the embedded row as an object or an array depending on the
  // inferred cardinality — normalize both.
  for (const row of (data ?? []) as {
    conversation_labels: { name: string; color: string } | { name: string; color: string }[] | null;
  }[]) {
    const label = Array.isArray(row.conversation_labels)
      ? row.conversation_labels[0]
      : row.conversation_labels;
    if (label?.name) out.push({ name: label.name, color: label.color });
  }
  return out;
}
