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
import { twilioTransport, isTwilioConfigured } from "@/lib/transport";
import {
  contentSidFor,
  templateSpec,
  greetingName,
  templateVariable,
  type TemplateKey,
} from "@/lib/templates";

export const DAILY_SEND_CAP = Number(process.env.BROADCAST_DAILY_CAP || 250);
const BATCH_SIZE = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

export type Segment = "all" | "week" | "month" | "upcoming" | "dormant";

export const SEGMENTS: { key: Segment; label: string; hint: string }[] = [
  { key: "all", label: "كل العملاء", hint: "القائمة كاملة" },
  { key: "week", label: "حجزوا هذا الأسبوع", hint: "آخر حجز خلال ٧ أيام" },
  { key: "month", label: "حجزوا هذا الشهر", hint: "آخر حجز خلال ٣٠ يومًا" },
  { key: "upcoming", label: "لديهم حجز قادم", hint: "موعد قادم لم يحن بعد" },
  { key: "dormant", label: "بدون حجز حديث", hint: "لا حجز في الفترة المسجّلة" },
];

export function isSegment(v: string): v is Segment {
  return SEGMENTS.some((s) => s.key === v);
}

interface CustomerRow {
  id: string;
  phone_number: string | null;
  full_name: string | null;
  opted_out: boolean | null;
  metadata: Record<string, unknown> | null;
}

interface BroadcastMark {
  status: "sent" | "failed";
  sid?: string | null;
  error?: string | null;
  at: string;
}

const digits = (p: string | null | undefined) => (p || "").replace(/\D/g, "");
const marks = (row: CustomerRow) =>
  (row.metadata?.broadcasts as Record<string, BroadcastMark>) ?? {};
const lastBooking = (row: CustomerRow) =>
  (row.metadata?.last_booking_at as string | undefined) ?? null;
const nextBooking = (row: CustomerRow) =>
  (row.metadata?.next_booking_at as string | undefined) ?? null;

function inSegment(row: CustomerRow, segment: Segment): boolean {
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
  }
}

async function loadAllCustomers(): Promise<CustomerRow[]> {
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
 * only exist in `rekaz_reservations`, and stamp everyone's latest past booking
 * and nearest future booking so segments read straight off the row. Idempotent
 * — safe to run before every send.
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
    { phone: string; name: string | null; last: string | null; next: string | null }
  >();
  for (const r of resv) {
    const d = digits(r.customer_phone);
    if (!d) continue;
    const at = r.arrival_at ? new Date(r.arrival_at).getTime() : null;
    const entry =
      booking.get(d) ?? { phone: `+${d}`, name: r.customer_name?.trim() || null, last: null, next: null };
    if (at !== null) {
      if (at <= now) {
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
      if (meta.last_booking_at === b.last && meta.next_booking_at === b.next) continue;
      toUpdate.push({
        id: current.id,
        metadata: { ...meta, last_booking_at: b.last, next_booking_at: b.next },
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
  const out = { all: 0, week: 0, month: 0, upcoming: 0, dormant: 0 } as Record<Segment, number>;
  for (const row of rows) for (const s of SEGMENTS) if (inSegment(row, s.key)) out[s.key] += 1;
  return out;
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
): Promise<DrainResult> {
  const admin = getAdminSupabaseClient();
  if (!isTwilioConfigured()) throw new Error("Twilio is not configured.");
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

  const pending = all.filter(
    (r) => inSegment(r, segment) && marks(r)[templateKey]?.status !== "sent",
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
      const res = await twilioTransport.sendTemplate(phone, contentSid, vars);
      mark = { status: "sent", sid: res.providerMessageId || null, at: new Date().toISOString() };
      sent += 1;
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
