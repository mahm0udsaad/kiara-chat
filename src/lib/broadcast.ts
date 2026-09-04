/**
 * One-time template broadcasts to the customer list.
 *
 * State lives on the customer row itself (`customers.metadata.broadcasts`)
 * rather than in a new table — so this needs no migration and is resumable by
 * construction: a send that already happened leaves a marker, and the next
 * pass simply skips anyone already marked `sent`. A `failed` marker is retried,
 * because the usual reason a marketing send fails early is that the template is
 * still awaiting Meta approval, and those should go out once it clears.
 *
 * Sends go over Twilio from the Business number (a template is a Business-
 * Platform capability), and deliberately do NOT open a conversation per
 * recipient — 676 empty threads would bury the inbox. When a customer replies,
 * the inbound webhook creates her thread naturally.
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

/**
 * WhatsApp caps how many unique customers a business can *start* a conversation
 * with in 24 hours by messaging-tier. A brand-new, unverified number usually
 * sits at 250/day — so a 676-person blast spans about three days, and trying to
 * push it all at once just earns rejections. The cap is deliberately
 * conservative and overridable once the number's real tier is known.
 */
export const DAILY_SEND_CAP = Number(process.env.BROADCAST_DAILY_CAP || 250);

/** How many to send per drain call, to stay well inside a function's budget. */
const BATCH_SIZE = 20;

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

function marks(row: CustomerRow): Record<string, BroadcastMark> {
  const m = (row.metadata?.broadcasts as Record<string, BroadcastMark>) ?? {};
  return m;
}

export interface BroadcastStatus {
  templateKey: TemplateKey;
  approvedConfigured: boolean;
  total: number;
  sent: number;
  failed: number;
  remaining: number;
  sentLast24h: number;
  dailyCap: number;
  dailyRemaining: number;
}

/** Everyone eligible: has a phone, not opted out. */
async function loadEligible(): Promise<CustomerRow[]> {
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

export async function broadcastStatus(
  templateKey: TemplateKey,
): Promise<BroadcastStatus> {
  const rows = await loadEligible();
  let sent = 0;
  let failed = 0;
  let sentLast24h = 0;
  const since = Date.now() - 24 * 60 * 60 * 1000;
  for (const row of rows) {
    const mark = marks(row)[templateKey];
    if (!mark) continue;
    if (mark.status === "sent") {
      sent += 1;
      if (new Date(mark.at).getTime() >= since) sentLast24h += 1;
    } else if (mark.status === "failed") {
      failed += 1;
    }
  }
  const remaining = rows.length - sent;
  return {
    templateKey,
    approvedConfigured: Boolean(contentSidFor(templateKey)),
    total: rows.length,
    sent,
    failed,
    remaining,
    sentLast24h,
    dailyCap: DAILY_SEND_CAP,
    dailyRemaining: Math.max(0, DAILY_SEND_CAP - sentLast24h),
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

/**
 * Send the next batch. Picks recipients not yet marked `sent`, sends each, and
 * writes the outcome back to that customer. Honours the daily cap so a run can
 * be repeated freely without ever exceeding what WhatsApp allows in a day.
 */
export async function sendBroadcastBatch(
  templateKey: TemplateKey,
): Promise<DrainResult> {
  const admin = getAdminSupabaseClient();

  if (!isTwilioConfigured()) throw new Error("Twilio is not configured.");
  const contentSid = contentSidFor(templateKey);
  if (!contentSid) {
    throw new Error(
      `القالب «${templateSpec(templateKey).label}» غير مُهيّأ بعد — أضيفي متغيّر الـ Content SID بعد اعتماد القالب.`,
    );
  }

  const rows = await loadEligible();
  const sentLast24h = rows.filter((r) => {
    const m = marks(r)[templateKey];
    return (
      m?.status === "sent" &&
      Date.now() - new Date(m.at).getTime() < 24 * 60 * 60 * 1000
    );
  }).length;

  let budget = Math.max(0, DAILY_SEND_CAP - sentLast24h);
  const dailyCapReached = budget <= 0;

  // Retry failures too (a marketing send fails while the template is still in
  // review); only a confirmed `sent` is skipped.
  const pending = rows.filter((r) => marks(r)[templateKey]?.status !== "sent");

  let attempted = 0;
  let sent = 0;
  let failed = 0;
  let lastError: string | null = null;

  const spec = templateSpec(templateKey);

  for (const row of pending) {
    if (attempted >= BATCH_SIZE || budget <= 0) break;
    const phone = (row.phone_number || "").trim();
    if (!phone) continue;
    attempted += 1;
    budget -= 1;

    // Fill any variables the template declares (the notice has none).
    const vars: Record<string, string> = {};
    for (const v of spec.variables) {
      vars[v.key] =
        v.prefill === "customer_name"
          ? greetingName(row.full_name)
          : templateVariable("", v.maxLength ?? 512);
    }

    let mark: BroadcastMark;
    try {
      const res = await twilioTransport.sendTemplate(phone, contentSid, vars);
      mark = { status: "sent", sid: res.providerMessageId || null, at: new Date().toISOString() };
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastError = message;
      mark = {
        status: "failed",
        error: message.slice(0, 300),
        at: new Date().toISOString(),
      };
      failed += 1;
    }

    const meta = (row.metadata as Record<string, unknown> | null) ?? {};
    const broadcasts = (meta.broadcasts as Record<string, BroadcastMark>) ?? {};
    await admin
      .from("customers")
      .update({
        metadata: { ...meta, broadcasts: { ...broadcasts, [templateKey]: mark } },
      })
      .eq("id", row.id);
  }

  return {
    attempted,
    sent,
    failed,
    dailyCapReached: dailyCapReached || budget <= 0,
    lastError,
    status: await broadcastStatus(templateKey),
  };
}
