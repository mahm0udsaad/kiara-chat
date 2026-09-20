/**
 * One-time template broadcasts to the customer list, with recency segments.
 *
 * Two facts about the data shape this file:
 *  - The `customers` table is a stale one-time Rekaz import; who is actually
 *    booking now lives in `rekaz_reservations` and barely overlaps it. So the
 *    audience is the UNION of both, deduped by phone, materialised into
 *    `customers` so send-state and segment live in one place.
 *  - Send-state lives on the customer row (`customers.metadata.broadcasts`), so
 *    a broadcast needs no new table and is resumable: a confirmed send leaves a
 *    marker the next pass skips; a failure is retried (a marketing send fails
 *    until Meta finishes approving the template).
 *
 * Booking recency is denormalised onto the customer at sync time
 * (`metadata.last_booking_at` / `next_booking_at`) so a segment is a cheap read
 * rather than a join on every request.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import {
  customerProvider,
  isProviderConfigured,
  transportFor,
} from "@/lib/transport";
import {
  contentSidFor,
  templateSpec,
  greetingName,
  templateVariable,
  type TemplateKey,
} from "@/lib/templates";
import { findOrCreateConversation, saveMessage } from "@/lib/server-conversations";
import { bookingStageOf } from "@/lib/booking-stage";
import { contactOutcomeOf } from "@/lib/contact-outcome";
import { conversationCsStatus } from "@/lib/mobile/conversations";
import type { BookingStage, ContactOutcome, CsStatus } from "@/lib/types";

export const DAILY_SEND_CAP = Number(process.env.BROADCAST_DAILY_CAP || 2000);
const BATCH_SIZE = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

export type Segment = "all" | "week" | "month" | "upcoming" | "dormant" | "repeat_idle";

export const SEGMENTS: { key: Segment; label: string; hint: string }[] = [
  { key: "all", label: "كل العملاء", hint: "القائمة كاملة" },
  { key: "week", label: "حجزوا هذا الأسبوع", hint: "آخر حجز خلال ٧ أيام" },
  { key: "month", label: "حجزوا هذا الشهر", hint: "آخر حجز خلال ٣٠ يومًا" },
  { key: "upcoming", label: "لديهم حجز قادم", hint: "موعد قادم لم يحن بعد" },
  { key: "dormant", label: "بدون حجز حديث", hint: "لا حجز في الفترة المسجّلة" },
  {
    key: "repeat_idle",
    label: "عميلات متكررات لم يحجزن مؤخرًا",
    hint: "حجزن مرتين فأكثر، وآخر حجز قبل أكثر من ٥ أيام — أقرب من يستحق العرض",
  },
];

export function isSegment(v: string): v is Segment {
  return SEGMENTS.some((s) => s.key === v);
}

export interface CustomerRow {
  id: string;
  phone_number: string | null;
  full_name: string | null;
  opted_out: boolean | null;
  metadata: Record<string, unknown> | null;
}

export interface BroadcastMark {
  status: "sent" | "failed";
  sid?: string | null;
  error?: string | null;
  at: string;
}

const digits = (p: string | null | undefined) => (p || "").replace(/\D/g, "");

/** Phones are stored in several shapes; the national tail is what matches. */
const phoneKey = (value: string | null | undefined) => digits(value).slice(-9);

/** Sends across every campaign/broadcast in the last 24h — the number's cap. */
export function globalSentLast24h(rows: CustomerRow[]): number {
  const since = Date.now() - DAY_MS;
  let n = 0;
  for (const row of rows) {
    const all = (row.metadata?.broadcasts as Record<string, BroadcastMark>) ?? {};
    for (const key of Object.keys(all)) {
      const m = all[key];
      if (m?.status === "sent" && new Date(m.at).getTime() >= since) {
        n += 1;
        break; // one number-send per customer per day is the unit that counts
      }
    }
  }
  return n;
}
const marks = (row: CustomerRow) =>
  (row.metadata?.broadcasts as Record<string, BroadcastMark>) ?? {};
const lastBooking = (row: CustomerRow) =>
  (row.metadata?.last_booking_at as string | undefined) ?? null;
const nextBooking = (row: CustomerRow) =>
  (row.metadata?.next_booking_at as string | undefined) ?? null;
/** Count of past bookings, stamped by `syncAudienceFromReservations`. */
const bookingCount = (row: CustomerRow) =>
  (row.metadata?.booking_count as number | undefined) ?? 0;
const REPEAT_IDLE_MIN_BOOKINGS = 2;
const REPEAT_IDLE_DAYS = 5;

export function inSegment(row: CustomerRow, segment: Segment): boolean {
  if (segment === "all") return true;
  const now = Date.now();
  const lp = lastBooking(row) ? new Date(lastBooking(row)!).getTime() : null;
  const nx = nextBooking(row) ? new Date(nextBooking(row)!).getTime() : null;
  switch (segment) {
    case "week":
      return lp !== null && lp > now - 7 * DAY_MS;
    case "month":
      return lp !== null && lp > now - 30 * DAY_MS;
    case "upcoming":
      return nx !== null && nx > now;
    case "dormant":
      return lp === null && nx === null;
    case "repeat_idle":
      return (
        bookingCount(row) >= REPEAT_IDLE_MIN_BOOKINGS &&
        lp !== null &&
        lp <= now - REPEAT_IDLE_DAYS * DAY_MS
      );
  }
}

export async function loadAllCustomers(): Promise<CustomerRow[]> {
  const admin = getAdminSupabaseClient();
  const rows: CustomerRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin
      .from("customers")
      .select("id, phone_number, full_name, opted_out, metadata")
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .eq("opted_out", false)
      .not("phone_number", "is", null)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as CustomerRow[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

/**
 * Fold recent bookings into the customer list: create rows for customers who
 * only exist in `rekaz_reservations`, and stamp everyone's latest past booking,
 * nearest future booking, and past-booking count so segments (including
 * "repeat_idle") read straight off the row. Idempotent — safe to run before
 * every send.
 */
export async function syncAudienceFromReservations(): Promise<{ audience: number }> {
  const admin = getAdminSupabaseClient();

  const resv: { customer_phone: string | null; customer_name: string | null; arrival_at: string | null }[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin
      .from("rekaz_reservations")
      .select("customer_phone, customer_name, arrival_at")
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    resv.push(...batch);
    if (batch.length < pageSize) break;
  }

  const now = Date.now();
  const booking = new Map<
    string,
    { phone: string; name: string | null; last: string | null; next: string | null; count: number }
  >();
  for (const r of resv) {
    const d = digits(r.customer_phone);
    if (!d) continue;
    const at = r.arrival_at ? new Date(r.arrival_at).getTime() : null;
    const entry =
      booking.get(d) ??
      { phone: `+${d}`, name: r.customer_name?.trim() || null, last: null, next: null, count: 0 };
    if (at !== null) {
      if (at <= now) {
        entry.count += 1;
        if (!entry.last || at > new Date(entry.last).getTime()) entry.last = r.arrival_at;
      } else if (!entry.next || at < new Date(entry.next).getTime()) {
        entry.next = r.arrival_at;
      }
    }
    if (!entry.name && r.customer_name?.trim()) entry.name = r.customer_name.trim();
    booking.set(d, entry);
  }

  const existing = await loadAllCustomers();
  const byPhone = new Map(existing.map((c) => [digits(c.phone_number), c]));

  // Split into new customers (one bulk insert) and booking-date updates (only
  // those whose dates actually changed). Row-at-a-time here meant hundreds of
  // sequential round-trips — slow enough to risk the function's budget, and it
  // hid a failing insert behind an unchecked error.
  const toInsert: Record<string, unknown>[] = [];
  const toUpdate: { id: string; metadata: Record<string, unknown> }[] = [];

  for (const [d, b] of booking) {
    const current = byPhone.get(d);
    if (current) {
      const meta = (current.metadata as Record<string, unknown> | null) ?? {};
      if (
        meta.last_booking_at === b.last &&
        meta.next_booking_at === b.next &&
        meta.booking_count === b.count
      )
        continue;
      toUpdate.push({
        id: current.id,
        metadata: { ...meta, last_booking_at: b.last, next_booking_at: b.next, booking_count: b.count },
      });
    } else {
      // `source` is guarded by a check constraint admitting only the values
      // already in use; a recent booking is still a Rekaz-sourced customer.
      toInsert.push({
        restaurant_id: KIARA_RESTAURANT_ID,
        phone_number: b.phone,
        full_name: b.name,
        source: "rekaz_import",
        opted_out: false,
        metadata: {
          origin: "rekaz_reservation",
          last_booking_at: b.last,
          next_booking_at: b.next,
          booking_count: b.count,
        },
      });
    }
  }

  if (toInsert.length) {
    // Upsert on the (restaurant_id, phone_number) unique index, ignoring
    // duplicates — a plain bulk insert is atomic, so a single already-present
    // phone (e.g. an opted-out customer not in our read) would reject the whole
    // batch and, on a swallowed 23505, add no one.
    const { error } = await admin
      .from("customers")
      .upsert(toInsert, {
        onConflict: "restaurant_id,phone_number",
        ignoreDuplicates: true,
      });
    if (error) throw new Error(`customer sync insert failed: ${error.message}`);
  }
  for (const u of toUpdate) {
    await admin.from("customers").update({ metadata: u.metadata }).eq("id", u.id);
  }

  return { audience: existing.length + toInsert.length };
}

export interface RepeatIdleCustomer {
  id: string;
  phone: string;
  name: string | null;
  bookingCount: number;
  lastBookingAt: string;
  idleDays: number;
}

/**
 * Repeat bookers who have gone quiet: at least `minBookings` past reservations
 * and more than `idleDays` since the most recent one. This is a targeting cut
 * the `Segment` union can't express (it only knows recency, not repetition),
 * so it reads `rekaz_reservations` directly rather than the denormalised
 * `last_booking_at` — counting bookings needs every row, not just the latest.
 * Matched back to `customers` by phone so the result carries a row id a
 * campaign can target.
 */
export async function repeatIdleCustomers(
  minBookings: number,
  idleDays: number,
): Promise<RepeatIdleCustomer[]> {
  const admin = getAdminSupabaseClient();
  const resv: { customer_phone: string | null; customer_name: string | null; arrival_at: string | null }[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin
      .from("rekaz_reservations")
      .select("customer_phone, customer_name, arrival_at")
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    resv.push(...batch);
    if (batch.length < pageSize) break;
  }

  const now = Date.now();
  const perPhone = new Map<string, { count: number; last: number; name: string | null }>();
  for (const r of resv) {
    const at = r.arrival_at ? new Date(r.arrival_at).getTime() : null;
    if (at === null || at > now) continue; // only bookings that actually happened
    const d = digits(r.customer_phone);
    if (!d) continue;
    const entry = perPhone.get(d) ?? { count: 0, last: 0, name: null };
    entry.count += 1;
    if (at > entry.last) entry.last = at;
    if (!entry.name && r.customer_name?.trim()) entry.name = r.customer_name.trim();
    perPhone.set(d, entry);
  }

  const customers = await loadAllCustomers();
  const byPhone = new Map(customers.map((c) => [digits(c.phone_number), c]));

  const out: RepeatIdleCustomer[] = [];
  for (const [phone, entry] of perPhone) {
    if (entry.count < minBookings) continue;
    const idle = (now - entry.last) / DAY_MS;
    if (idle <= idleDays) continue;
    const customer = byPhone.get(phone);
    if (!customer) continue; // opted out, or not in the synced audience
    out.push({
      id: customer.id,
      phone: customer.phone_number ?? `+${phone}`,
      name: entry.name ?? customer.full_name ?? null,
      bookingCount: entry.count,
      lastBookingAt: new Date(entry.last).toISOString(),
      idleDays: Math.floor(idle),
    });
  }
  return out.sort((a, b) => b.bookingCount - a.bookingCount);
}

export interface BroadcastStatus {
  templateKey: TemplateKey;
  segment: Segment;
  approvedConfigured: boolean;
  total: number;
  sent: number;
  failed: number;
  remaining: number;
  sentLast24h: number;
  dailyCap: number;
  dailyRemaining: number;
  segmentCounts: Record<Segment, number>;
}

function countSegments(rows: CustomerRow[]): Record<Segment, number> {
  const out = { all: 0, week: 0, month: 0, upcoming: 0, dormant: 0, repeat_idle: 0 } as Record<Segment, number>;
  for (const row of rows) for (const s of SEGMENTS) if (inSegment(row, s.key)) out[s.key] += 1;
  return out;
}

export async function segmentCounts(): Promise<Record<Segment, number>> {
  return countSegments(await loadAllCustomers());
}

export async function broadcastStatus(
  templateKey: TemplateKey,
  segment: Segment,
): Promise<BroadcastStatus> {
  const all = await loadAllCustomers();
  const rows = all.filter((r) => inSegment(r, segment));
  const since = Date.now() - DAY_MS;
  let sent = 0;
  let failed = 0;
  // The daily cap is global to the number, so it counts sends across every
  // segment — not just this one.
  let sentLast24h = 0;
  for (const row of all) {
    const mark = marks(row)[templateKey];
    if (mark?.status === "sent" && new Date(mark.at).getTime() >= since) sentLast24h += 1;
  }
  for (const row of rows) {
    const mark = marks(row)[templateKey];
    if (mark?.status === "sent") sent += 1;
    else if (mark?.status === "failed") failed += 1;
  }
  return {
    templateKey,
    segment,
    approvedConfigured: Boolean(contentSidFor(templateKey)),
    total: rows.length,
    sent,
    failed,
    remaining: rows.length - sent,
    sentLast24h,
    dailyCap: DAILY_SEND_CAP,
    dailyRemaining: Math.max(0, DAILY_SEND_CAP - sentLast24h),
    segmentCounts: countSegments(all),
  };
}

export interface DrainResult {
  attempted: number;
  sent: number;
  failed: number;
  status: BroadcastStatus;
  dailyCapReached: boolean;
  lastError: string | null;
}

export async function sendBroadcastBatch(
  templateKey: TemplateKey,
  segment: Segment,
  /**
   * Exactly whom to send to, when the employee picked the numbers herself.
   * Undefined keeps the old behaviour: everyone in the segment. An empty list
   * is not the same thing — she selected nobody, so nothing is sent.
   */
  onlyPhones?: string[],
): Promise<DrainResult> {
  const admin = getAdminSupabaseClient();
  const provider = customerProvider();
  if (!isProviderConfigured(provider)) {
    throw new Error("The active WhatsApp provider is not configured.");
  }
  const transport = transportFor(provider);
  const contentSid = contentSidFor(templateKey);
  if (!contentSid) {
    throw new Error(
      `القالب «${templateSpec(templateKey).label}» غير مُهيّأ بعد — أضيفي متغيّر الـ Content SID بعد اعتماد القالب.`,
    );
  }

  const all = await loadAllCustomers();
  const since = Date.now() - DAY_MS;
  const sentLast24h = all.filter((r) => {
    const m = marks(r)[templateKey];
    return m?.status === "sent" && new Date(m.at).getTime() >= since;
  }).length;
  let budget = Math.max(0, DAILY_SEND_CAP - sentLast24h);
  const dailyCapReached = budget <= 0;

  const chosen = onlyPhones ? new Set(onlyPhones.map((phone) => phoneKey(phone))) : null;
  const pending = all.filter(
    (r) =>
      inSegment(r, segment) &&
      marks(r)[templateKey]?.status !== "sent" &&
      (!chosen || chosen.has(phoneKey(r.phone_number))),
  );

  const spec = templateSpec(templateKey);
  let attempted = 0;
  let sent = 0;
  let failed = 0;
  let lastError: string | null = null;

  for (const row of pending) {
    if (attempted >= BATCH_SIZE || budget <= 0) break;
    const phone = (row.phone_number || "").trim();
    if (!phone) continue;
    attempted += 1;
    budget -= 1;

    const vars: Record<string, string> = {};
    for (const v of spec.variables) {
      vars[v.key] =
        v.prefill === "customer_name" ? greetingName(row.full_name) : templateVariable("", v.maxLength ?? 512);
    }

    let mark: BroadcastMark;
    try {
      const res = await transport.sendTemplate(phone, contentSid, vars);
      mark = { status: "sent", sid: res.providerMessageId || null, at: new Date().toISOString() };
      sent += 1;

      // Ensure conversation and message row exist so status webhooks and inbox link immediately
      try {
        const conv = await findOrCreateConversation(phone, row.full_name);
        if (res.providerMessageId) {
          await saveMessage({
            conversationId: conv.id,
            role: "agent",
            content: spec.body,
            messageType: "template",
            externalMessageSid: res.providerMessageId,
            metadata: { template: templateKey, broadcast: true },
            deliveryStatus: "sent",
          });
        }
      } catch (convErr) {
        console.warn("[broadcast] failed to create conversation/message record for broadcast:", convErr);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastError = message;
      mark = { status: "failed", error: message.slice(0, 300), at: new Date().toISOString() };
      failed += 1;
    }

    const meta = (row.metadata as Record<string, unknown> | null) ?? {};
    const broadcasts = (meta.broadcasts as Record<string, BroadcastMark>) ?? {};
    await admin
      .from("customers")
      .update({ metadata: { ...meta, broadcasts: { ...broadcasts, [templateKey]: mark } } })
      .eq("id", row.id);
  }

  return {
    attempted,
    sent,
    failed,
    dailyCapReached: dailyCapReached || budget <= 0,
    lastError,
    status: await broadcastStatus(templateKey, segment),
  };
}

/* ------------------------------------------------------------------ *
 * Picking the audience by hand.
 *
 * A segment answers "who booked recently"; it cannot answer "the women Huda
 * has been talking to", or "everyone we marked as awaiting a booking". Those
 * live on the conversation, which is where the inbox already files them — so
 * the campaign screen reads the same labels, statuses, stages and outcomes the
 * chat list filters by, and lets the employee tick the exact numbers on top.
 *
 * Deliberately a read: nothing here sends. The chosen phones are passed back
 * to sendBroadcastBatch, which still enforces the daily cap and still skips
 * anyone already sent to.
 * ------------------------------------------------------------------ */

export interface AudienceMember {
  phone: string;
  name: string | null;
  lastBookingAt: string | null;
  nextBookingAt: string | null;
  bookings: number;
  /** This template's send state for her, if it has been tried. */
  state: "sent" | "failed" | null;
  conversationId: string | null;
  csStatus: CsStatus | null;
  bookingStage: BookingStage | null;
  contactOutcome: ContactOutcome | null;
  labelIds: string[];
}

export interface AudienceFilters {
  labelId?: string | null;
  status?: CsStatus | null;
  bookingStage?: BookingStage | null;
  contactOutcome?: ContactOutcome | null;
  /** Name or number, matched the way the inbox search does. */
  search?: string | null;
  /** Off by default: a campaign list is about who has NOT been sent to yet. */
  includeSent?: boolean;
}


async function conversationIndex(): Promise<
  Map<
    string,
    {
      id: string;
      csStatus: CsStatus;
      bookingStage: BookingStage | null;
      contactOutcome: ContactOutcome | null;
      labelIds: string[];
    }
  >
> {
  const admin = getAdminSupabaseClient();
  const index = new Map<
    string,
    {
      id: string;
      csStatus: CsStatus;
      bookingStage: BookingStage | null;
      contactOutcome: ContactOutcome | null;
      labelIds: string[];
    }
  >();
  const byId = new Map<string, string>();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin
      .from("conversations")
      .select("id, customer_phone, status, metadata, last_message_at")
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .order("last_message_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    for (const row of batch) {
      const key = phoneKey(row.customer_phone as string);
      // A number may carry several threads; the newest is the live one, and
      // the ordering above means it is the one already in the map.
      if (!key || index.has(key)) continue;
      const conversation = row as unknown as Parameters<typeof conversationCsStatus>[0] &
        Parameters<typeof bookingStageOf>[0];
      index.set(key, {
        id: row.id as string,
        csStatus: conversationCsStatus(conversation),
        bookingStage: bookingStageOf(conversation),
        contactOutcome: contactOutcomeOf(conversation),
        labelIds: [],
      });
      byId.set(row.id as string, key);
    }
    if (batch.length < pageSize) break;
  }

  const { data: assignments } = await admin
    .from("conversation_label_assignments")
    .select("conversation_id, label_id");
  for (const row of assignments ?? []) {
    const key = byId.get(row.conversation_id as string);
    const entry = key ? index.get(key) : null;
    if (entry) entry.labelIds.push(row.label_id as string);
  }
  return index;
}

export async function listAudience(
  templateKey: TemplateKey,
  segment: Segment,
  filters: AudienceFilters = {},
): Promise<{ members: AudienceMember[]; labels: { id: string; name: string; color: string }[] }> {
  const admin = getAdminSupabaseClient();
  const [all, conversations, labelRows] = await Promise.all([
    loadAllCustomers(),
    conversationIndex(),
    admin
      .from("conversation_labels")
      .select("id, name, color")
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .order("name"),
  ]);

  const search = (filters.search ?? "").trim().toLocaleLowerCase("ar");
  const searchDigits = digits(filters.search ?? "");
  const members: AudienceMember[] = [];
  for (const row of all) {
    if (!inSegment(row, segment)) continue;
    const phone = (row.phone_number || "").trim();
    if (!phone) continue;
    const mark = marks(row)[templateKey];
    if (mark?.status === "sent" && !filters.includeSent) continue;

    const conversation = conversations.get(phoneKey(phone)) ?? null;
    if (filters.status && conversation?.csStatus !== filters.status) continue;
    if (filters.bookingStage && conversation?.bookingStage !== filters.bookingStage) continue;
    if (filters.contactOutcome && conversation?.contactOutcome !== filters.contactOutcome) continue;
    if (filters.labelId && !conversation?.labelIds.includes(filters.labelId)) continue;
    if (search || searchDigits) {
      const name = (row.full_name ?? "").toLocaleLowerCase("ar");
      const matches =
        (search && name.includes(search)) ||
        (searchDigits && digits(phone).includes(searchDigits));
      if (!matches) continue;
    }

    members.push({
      phone,
      name: row.full_name,
      lastBookingAt: lastBooking(row),
      nextBookingAt: nextBooking(row),
      bookings: bookingCount(row),
      state: mark?.status ?? null,
      conversationId: conversation?.id ?? null,
      csStatus: conversation?.csStatus ?? null,
      bookingStage: conversation?.bookingStage ?? null,
      contactOutcome: conversation?.contactOutcome ?? null,
      labelIds: conversation?.labelIds ?? [],
    });
  }

  // Newest booking first: the women most recently in the salon are the ones an
  // employee recognises, and the ones an offer is most likely aimed at.
  members.sort((left, right) =>
    (right.lastBookingAt ?? "").localeCompare(left.lastBookingAt ?? ""),
  );
  return {
    members,
    labels: (labelRows.data ?? []) as { id: string; name: string; color: string }[],
  };
}
