import "server-only";

import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import { templateKeyForContentSid, templateSpec } from "@/lib/templates";
import { metaCloudConfig, metaGraphCall } from "@/lib/transport/meta-api";
import { listMetaTemplatesWithStatus } from "@/lib/transport/meta-content";

/**
 * What the WhatsApp Cloud API cost, day by day, in Saudi riyals.
 *
 * Meta has charged per delivered template since July 2025. A reply inside the
 * customer's open 24-hour window is free, and so is a utility template sent
 * inside one; a marketing template is charged wherever it lands. So the bill
 * is the templates, not the conversation volume.
 *
 * The figure comes from Meta's own `pricing_analytics` on the WABA when it can
 * be read — the cost Meta will invoice. When it cannot (a token without the
 * permission, Meta down), it is estimated from the templates this app sent and
 * saw delivered, priced with the published rate card below, and says so.
 */

/**
 * Meta's SAR rate card for Saudi numbers, effective 1 October 2026.
 * Source: the "SAR rates" file on
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
 * Update together with `effectiveFrom` when Meta publishes a new card.
 */
export const META_SAUDI_RATES_SAR = {
  effectiveFrom: "2026-10-01",
  marketing: 0.2159,
  utility: 0.0401,
  authentication: 0.0401,
} as const;

/** The riyal is pegged; a USD-billed WABA converts at the peg. */
const SAR_PER_USD = 3.75;
const CACHE_TTL_MS = 15 * 60_000;
const OPEN_WINDOW_MS = 24 * 3600_000;
const PAGE_SIZE = 1_000;
const ID_BATCH_SIZE = 200;

export type MetaSpendCategory = "marketing" | "utility" | "authentication";

export type MetaSpendDay = {
  /** YYYY-MM-DD. Meta's daily buckets are UTC days. */
  day: string;
  costSar: number;
  /** Charged deliveries by category. */
  marketing: number;
  utility: number;
  authentication: number;
  /** Deliveries Meta did not charge for (inside an open window, ads entry). */
  free: number;
};

export type MetaSpend = {
  /** "meta": Meta's own figures; "estimate": priced here from our sends. */
  source: "meta" | "estimate";
  currency: "SAR";
  costSar: number;
  byCategory: Record<MetaSpendCategory, { count: number; costSar: number }>;
  free: number;
  days: MetaSpendDay[];
  rates: typeof META_SAUDI_RATES_SAR;
  /**
   * What Meta bills, in the WABA's own currency, when that is not SAR. Kiara's
   * WABA bills in ARS, so `costSar` is Meta's delivered volumes priced at the
   * SAR rate card — the same list price, converted at Meta's own ratio.
   */
  billed: { currency: string; amount: number } | null;
  /** Why the figure is an estimate, when it is. */
  note: string | null;
};

const sar = (value: number) => Math.round(value * 100) / 100;

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function emptySpend(source: MetaSpend["source"], note: string | null): MetaSpend {
  return {
    source,
    currency: "SAR",
    costSar: 0,
    byCategory: {
      marketing: { count: 0, costSar: 0 },
      utility: { count: 0, costSar: 0 },
      authentication: { count: 0, costSar: 0 },
    },
    free: 0,
    days: [],
    rates: META_SAUDI_RATES_SAR,
    billed: null,
    note,
  };
}

function dayOf(days: Map<string, MetaSpendDay>, day: string): MetaSpendDay {
  const current = days.get(day) ?? {
    day,
    costSar: 0,
    marketing: 0,
    utility: 0,
    authentication: 0,
    free: 0,
  };
  days.set(day, current);
  return current;
}

function finish(spend: MetaSpend, days: Map<string, MetaSpendDay>): MetaSpend {
  spend.days = [...days.values()]
    .map((day) => ({ ...day, costSar: sar(day.costSar) }))
    .sort((a, b) => b.day.localeCompare(a.day));
  spend.costSar = sar(spend.days.reduce((sum, day) => sum + day.costSar, 0));
  for (const category of Object.values(spend.byCategory)) category.costSar = sar(category.costSar);
  return spend;
}

type PricingPoint = {
  start: number;
  end: number;
  volume?: number;
  cost?: number;
  pricing_type?: string;
  pricing_category?: string;
};

/** Meta's invoiced view: cost and volume per UTC day, category and pricing type. */
async function spendFromMeta(fromMs: number, toMs: number): Promise<MetaSpend> {
  const { wabaId } = metaCloudConfig();
  if (!wabaId) throw new Error("META_CLOUD_WABA_ID is not set");
  const start = Math.floor(fromMs / 1000);
  const end = Math.floor(toMs / 1000);
  const field =
    `pricing_analytics.start(${start}).end(${end}).granularity(DAILY)` +
    ".dimensions(PRICING_CATEGORY,PRICING_TYPE)";
  const response = await metaGraphCall<{
    currency?: string;
    pricing_analytics?: { data?: { data_points?: PricingPoint[] }[] };
  }>(`/${wabaId}?fields=currency,${encodeURIComponent(field)}`);

  const currency = response.currency?.toUpperCase() ?? "";
  // SAR is read as billed and USD at the peg. Any other billing currency is
  // priced from Meta's volumes at the SAR rate card: Meta's cards for every
  // currency are the same list price, so this is the bill in riyals.
  const toSar = currency === "SAR" ? 1 : currency === "USD" ? SAR_PER_USD : null;

  const spend = emptySpend("meta", null);
  let billedAmount = 0;
  const days = new Map<string, MetaSpendDay>();
  for (const point of response.pricing_analytics?.data?.flatMap((row) => row.data_points ?? []) ?? []) {
    const volume = Number(point.volume) || 0;
    const billed = Number(point.cost) || 0;
    if (!volume && !billed) continue;
    billedAmount += billed;
    const day = dayOf(days, utcDay(point.start * 1000));
    if (point.pricing_type && point.pricing_type !== "REGULAR") {
      day.free += volume;
      spend.free += volume;
      continue;
    }
    const category: MetaSpendCategory | null =
      point.pricing_category === "MARKETING" || point.pricing_category === "MARKETING_LITE"
        ? "marketing"
        : point.pricing_category === "UTILITY"
          ? "utility"
          : point.pricing_category?.startsWith("AUTHENTICATION")
            ? "authentication"
            : null;
    if (!category) continue;
    const costSar = toSar === null ? volume * META_SAUDI_RATES_SAR[category] : billed * toSar;
    day.costSar += costSar;
    day[category] += volume;
    spend.byCategory[category].count += volume;
    spend.byCategory[category].costSar += costSar;
  }
  if (toSar === null && currency) {
    spend.billed = { currency, amount: Math.round(billedAmount * 100) / 100 };
  }
  return finish(spend, days);
}

type TemplateMessageRow = {
  conversation_id: string;
  created_at: string;
  metadata: { template?: { key?: string; contentSid?: string } } | null;
};

/** Template name → category, from Meta's template list, else this app's registry. */
async function templateCategories(): Promise<(name: string, sid: string) => MetaSpendCategory> {
  const fromMeta = new Map<string, MetaSpendCategory>();
  try {
    for (const template of await listMetaTemplatesWithStatus()) {
      fromMeta.set(
        template.name,
        template.category === "UTILITY"
          ? "utility"
          : template.category === "AUTHENTICATION"
            ? "authentication"
            : "marketing",
      );
    }
  } catch {
    // Meta unreachable: the registry below still knows the app's own templates.
  }
  return (name, sid) => {
    const known = fromMeta.get(name);
    if (known) return known;
    const key = templateKeyForContentSid(sid);
    // An unknown template is priced as marketing: an estimate that errs high
    // is safer for a budget than one that hides a cost.
    return key ? templateSpec(key).category : "marketing";
  };
}

/** Priced here: every Meta template this app saw delivered, at the rate card. */
async function estimateFromSends(fromMs: number, toMs: number, note: string): Promise<MetaSpend> {
  const admin = getAdminSupabaseClient();
  const sent: TemplateMessageRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from("messages")
      .select("conversation_id, created_at, metadata, conversations!inner(restaurant_id)")
      .eq("conversations.restaurant_id", KIARA_RESTAURANT_ID)
      .eq("role", "agent")
      .in("delivery_status", ["delivered", "read"])
      .not("metadata->template", "is", null)
      .gte("created_at", new Date(fromMs).toISOString())
      .lt("created_at", new Date(toMs).toISOString())
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    sent.push(...((data ?? []) as unknown as TemplateMessageRow[]));
    if ((data ?? []).length < PAGE_SIZE) break;
  }
  const metaSends = sent.filter((row) =>
    (row.metadata?.template?.contentSid ?? row.metadata?.template?.key ?? "").startsWith("meta:"),
  );

  // When each customer last wrote, to tell a free in-window utility template
  // from a charged one. Reaches a day back so the first morning is judged too.
  const inboundByConversation = new Map<string, number[]>();
  const conversationIds = [...new Set(metaSends.map((row) => row.conversation_id))];
  for (let index = 0; index < conversationIds.length; index += ID_BATCH_SIZE) {
    const { data, error } = await admin
      .from("messages")
      .select("conversation_id, created_at")
      .eq("role", "customer")
      .in("conversation_id", conversationIds.slice(index, index + ID_BATCH_SIZE))
      .gte("created_at", new Date(fromMs - OPEN_WINDOW_MS).toISOString())
      .lt("created_at", new Date(toMs).toISOString());
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as { conversation_id: string; created_at: string }[]) {
      const list = inboundByConversation.get(row.conversation_id) ?? [];
      list.push(Date.parse(row.created_at));
      inboundByConversation.set(row.conversation_id, list);
    }
  }
  const windowOpen = (conversationId: string, atMs: number) =>
    (inboundByConversation.get(conversationId) ?? []).some(
      (inboundMs) => inboundMs <= atMs && atMs - inboundMs < OPEN_WINDOW_MS,
    );

  const categoryOf = await templateCategories();
  const spend = emptySpend("estimate", note);
  const days = new Map<string, MetaSpendDay>();
  for (const row of metaSends) {
    const sid = row.metadata?.template?.contentSid ?? row.metadata?.template?.key ?? "";
    const name = sid.slice("meta:".length).split(":")[0] ?? "";
    const category = categoryOf(name, sid);
    const atMs = Date.parse(row.created_at);
    const day = dayOf(days, utcDay(atMs));
    if (category === "utility" && windowOpen(row.conversation_id, atMs)) {
      day.free += 1;
      spend.free += 1;
      continue;
    }
    const rate = META_SAUDI_RATES_SAR[category];
    day[category] += 1;
    day.costSar += rate;
    spend.byCategory[category].count += 1;
    spend.byCategory[category].costSar += rate;
  }
  return finish(spend, days);
}

const cache = new Map<string, { at: number; spend: MetaSpend }>();

/**
 * Spend over the Riyadh days `from`–`to`, as whole UTC days to match Meta's
 * buckets, never past now. Never throws: a report must render without it.
 */
export async function getMetaSpend(from: string, to: string): Promise<MetaSpend | null> {
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Math.min(Date.parse(`${to}T00:00:00Z`) + 86_400_000, Date.now());
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return null;
  const key = `${from}:${to}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.spend;

  let spend: MetaSpend | null = null;
  try {
    spend = await spendFromMeta(fromMs, toMs);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn("[meta-spend] pricing_analytics unavailable, estimating", reason);
    try {
      spend = await estimateFromSends(
        fromMs,
        toMs,
        "تقدير من القوالب المرسلة بأسعار Meta المعلنة؛ تعذّرت قراءة الفاتورة من Meta.",
      );
    } catch (estimateError) {
      console.error("[meta-spend] estimate failed", estimateError);
      return null;
    }
  }
  cache.set(key, { at: Date.now(), spend });
  return spend;
}
