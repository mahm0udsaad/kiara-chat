import "server-only";

import { pageRowsByDay } from "@/lib/paged-rows";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import { templateKeyForContentSid, templateSpec } from "@/lib/templates";
import { metaCloudConfig, metaGraphCall } from "@/lib/transport/meta-api";
import { listMetaTemplatesWithStatus } from "@/lib/transport/meta-content";

/**
 * What the WhatsApp Cloud API cost, day by day, in Saudi riyals.
 *
 * Meta charges per delivered message. Its docs call replies inside the
 * customer's 24-hour window free, but Kiara's own pricing_analytics (week of
 * 11 Oct 2026) shows every one of 5,559 service replies charged at the
 * regular service rate. So the bill is the reply volume, not the templates:
 * about 30 SAR a day, nine-tenths of it replies.
 *
 * The figure comes from Meta's own `pricing_analytics` for the days Meta has
 * published — it publishes a day late — and from the messages Meta delivered
 * for us, priced at the rate card below, for the days it has not.
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
  service: 0.0401,
} as const;

/** The riyal is pegged; a USD-billed WABA converts at the peg. */
const SAR_PER_USD = 3.75;
const CACHE_TTL_MS = 15 * 60_000;
const PAGE_SIZE = 1_000;

export type MetaSpendCategory = "marketing" | "utility" | "authentication" | "service";

export type MetaSpendDay = {
  /** YYYY-MM-DD. Meta's daily buckets are UTC days. */
  day: string;
  costSar: number;
  /** Charged deliveries by category. */
  marketing: number;
  utility: number;
  authentication: number;
  /** Free-form replies Meta charged for; Meta's docs say these are free. */
  service: number;
  /** Deliveries Meta did not charge for: replies and utility templates inside an open window. */
  free: number;
  /** SAR per charged category on this day. */
  categoryCostSar: Partial<Record<MetaSpendCategory, number>>;
  /** True when Meta had not published this day yet and it was priced from our sends. */
  estimated: boolean;
};

export type MetaSpend = {
  /**
   * "meta": every day from Meta's own figures; "estimate": none were, all
   * priced from our sends; "mixed": Meta for the days it has published, our
   * sends for the rest (Meta publishes a day's figures late).
   */
  source: "meta" | "estimate" | "mixed";
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
      service: { count: 0, costSar: 0 },
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
    service: 0,
    free: 0,
    categoryCostSar: {},
    estimated: false,
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
            : point.pricing_category === "SERVICE"
              ? "service"
              : null;
    if (!category) continue;
    const costSar = toSar === null ? volume * META_SAUDI_RATES_SAR[category] : billed * toSar;
    day.costSar += costSar;
    day.categoryCostSar[category] = (day.categoryCostSar[category] ?? 0) + costSar;
    day[category] += volume;
    spend.byCategory[category].count += volume;
    spend.byCategory[category].costSar += costSar;
  }
  if (toSar === null && currency) {
    spend.billed = { currency, amount: Math.round(billedAmount * 100) / 100 };
  }
  // One line per read, so what Meta actually reported can be checked against
  // the screen from the production logs.
  const points = response.pricing_analytics?.data?.flatMap((row) => row.data_points ?? []) ?? [];
  const summary: Record<string, number> = {};
  for (const point of points) {
    const key = `${point.pricing_category ?? "?"}/${point.pricing_type ?? "?"}`;
    summary[key] = (summary[key] ?? 0) + (Number(point.volume) || 0);
  }
  console.info(
    "[meta-spend] meta",
    JSON.stringify({ start, end, currency, points: points.length, volumes: summary, billed: billedAmount }),
  );
  return finish(spend, days);
}

type DeliveredMessageRow = {
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

/**
 * Priced here: every message Meta delivered for us (a `wamid.` id, delivered
 * or read), at the rate card — templates by their category, everything else
 * as a service reply. Meta's own figures for Kiara show every service reply
 * charged at the regular rate, none inside a free window, so none is
 * treated as free here either.
 *
 * Only templates need reading one by one, for their category; they are a few
 * hundred a month. Plain replies are all priced the same, so the database just
 * counts them per day. Downloading all ~28,000 of a month's replies to count
 * them used to compete with the report's own reads and slowed both.
 */
async function estimateFromSends(fromMs: number, toMs: number): Promise<MetaSpend> {
  const admin = getAdminSupabaseClient();
  const priced = () =>
    admin
      .from("messages")
      .select("created_at, metadata, conversations!inner(restaurant_id)", { count: "exact" })
      .eq("conversations.restaurant_id", KIARA_RESTAURANT_ID)
      .eq("role", "agent")
      .in("delivery_status", ["delivered", "read"])
      .like("external_message_sid", "wamid.%");

  const templates = await pageRowsByDay<DeliveredMessageRow>(
    fromMs,
    toMs,
    (sliceStart, sliceEnd, from, to) =>
      priced()
        .not("metadata->template", "is", null)
        .gte("created_at", sliceStart)
        .lt("created_at", sliceEnd)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    { pageSize: PAGE_SIZE },
  );

  // One count per UTC day — the same buckets Meta reports in.
  const dayStarts: number[] = [];
  for (let at = fromMs; at < toMs; at += 86_400_000) dayStarts.push(at);
  const replyCounts = await Promise.all(
    dayStarts.map(async (at) => {
      const { count, error } = await priced()
        .is("metadata->template", null)
        .gte("created_at", new Date(at).toISOString())
        .lt("created_at", new Date(Math.min(at + 86_400_000, toMs)).toISOString())
        .limit(1);
      if (error) throw new Error(error.message);
      return { day: utcDay(at), count: count ?? 0 };
    }),
  );

  const categoryOf = templates.length ? await templateCategories() : null;
  const spend = emptySpend("estimate", null);
  const days = new Map<string, MetaSpendDay>();
  const add = (dayKey: string, category: MetaSpendCategory, count: number) => {
    if (!count) return;
    const rate = META_SAUDI_RATES_SAR[category];
    const day = dayOf(days, dayKey);
    day[category] += count;
    day.costSar += rate * count;
    day.estimated = true;
    day.categoryCostSar[category] = (day.categoryCostSar[category] ?? 0) + rate * count;
    spend.byCategory[category].count += count;
    spend.byCategory[category].costSar += rate * count;
  };
  for (const { day, count } of replyCounts) add(day, "service", count);
  for (const row of templates) {
    const sid = row.metadata?.template?.contentSid ?? row.metadata?.template?.key ?? "";
    const category: MetaSpendCategory = sid && categoryOf
      ? categoryOf(sid.slice("meta:".length).split(":")[0] ?? "", sid)
      : "service";
    add(utcDay(Date.parse(row.created_at)), category, 1);
  }
  return finish(spend, days);
}

/**
 * Meta's figures for the days it has published, our priced sends for the
 * days it has not. Meta publishes a day late, so without this the current day
 * always read as free.
 */
function merge(meta: MetaSpend | null, estimate: MetaSpend | null): MetaSpend | null {
  if (!meta && !estimate) return null;
  const metaDays = new Map((meta?.days ?? []).map((day) => [day.day, day]));
  const chosen = new Map<string, MetaSpendDay>(metaDays);
  for (const day of estimate?.days ?? []) {
    if (!metaDays.has(day.day)) chosen.set(day.day, { ...day, estimated: true });
  }
  const estimatedDays = [...chosen.values()].filter((day) => day.estimated).length;
  const source: MetaSpend["source"] = !meta
    ? "estimate"
    : estimatedDays === 0
      ? "meta"
      : estimatedDays === chosen.size
        ? "estimate"
        : "mixed";
  const note = !meta
    ? "تقدير من الرسائل التي سلّمتها Meta بأسعارها المعلنة؛ تعذّرت قراءة أرقام Meta."
    : estimatedDays
      ? "الأيام المعلّمة «تقديري» لم تنشر Meta أرقامها بعد (تنشرها متأخرة يوماً)، فحُسبت من الرسائل التي سلّمتها Meta بأسعارها المعلنة."
      : null;
  const spend = emptySpend(source, note);
  spend.billed = meta?.billed ?? null;
  for (const day of chosen.values()) {
    spend.free += day.free;
    for (const category of ["marketing", "utility", "authentication", "service"] as const) {
      spend.byCategory[category].count += day[category];
      spend.byCategory[category].costSar += day.categoryCostSar[category] ?? 0;
    }
  }
  return finish(spend, chosen);
}

const cache = new Map<string, { at: number; spend: MetaSpend | null }>();

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

  const [meta, estimate] = await Promise.all([
    spendFromMeta(fromMs, toMs).catch((error) => {
      console.warn("[meta-spend] pricing_analytics unavailable", error instanceof Error ? error.message : error);
      return null;
    }),
    estimateFromSends(fromMs, toMs).catch((error) => {
      console.error("[meta-spend] estimate failed", error);
      return null;
    }),
  ]);
  const spend = merge(meta, estimate);
  cache.set(key, { at: Date.now(), spend });
  return spend;
}
