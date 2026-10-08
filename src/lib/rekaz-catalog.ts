/**
 * Pull the service list from Rekaz into `menu_items`.
 *
 * Rekaz is where the salon adds and prices services; `menu_items` is what the
 * composer, the bot and the order screens read. Until now the only bridge was
 * `scripts/sync-rekaz-catalog.mjs` run by hand from a text file, so a service
 * added in Rekaz never reached the app on its own. This is that script as a
 * button.
 *
 * The source is the salon's public booking site — the same two endpoints
 * rekaz.io/kyara-sba-1 calls to render its "خدماتنا" page. They answer with
 * just the tenant header, so unlike reservations this needs no Rekaz login.
 *
 * What a pull does:
 *  - adds every service the app does not have yet;
 *  - brings the name, price, section and photo of the ones it has in line with
 *    Rekaz, and shows one again if it had been hidden;
 *  - never touches a description that is already written — the public list has
 *    no variant labels, so it can only ever say less than what is there;
 *  - never hides anything. The public list is only what is on the website, so a
 *    service missing from it may still exist in Rekaz (an offer, a gift card, a
 *    staff-only extra). Those are reported back for an admin to hide by hand.
 */
import { createHash } from "crypto";

import { fetchWithTimeout } from "@/lib/http-timeout";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";

const PLATFORM = "https://platform.rekaz.io/api/app";
const REKAZ_TENANT_ID =
  process.env.REKAZ_TENANT_ID ?? "3a1f3638-e6dc-d864-4aa7-df60cdbb1146";
const FALLBACK_CATEGORY = "خدمات أخرى";

/** One bookable thing on the salon's Rekaz site, reduced to what the app keeps. */
export interface RekazService {
  rekazId: string;
  name: string;
  price: number | null;
  /** Every price option, cheapest first is not guaranteed — Rekaz's order. */
  options: { price: number | null; durationMinutes: number | null }[];
  category: string | null;
  imageUrl: string | null;
  /** Rekaz's own kind: Reservation, Bundle, Subscription… */
  type: string;
}

/** The `menu_items` columns a sync reads. */
export interface CatalogRow {
  id: string;
  name_ar: string | null;
  description_ar: string | null;
  price: number | string | null;
  category: string | null;
  image_url: string | null;
  is_available: boolean | null;
  created_at?: string | null;
}

export interface CatalogSyncResult {
  checkedAt: string;
  /** How many services the Rekaz site lists. */
  rekazCount: number;
  added: string[];
  updated: { name: string; changes: string[] }[];
  /** Shown in the app but absent from the Rekaz site — left alone, for review. */
  notOnRekaz: string[];
}

/**
 * Emoji, tatweel, wrapping dashes and spacing all differ between what was
 * crawled and what Rekaz shows today, and several services have since gained
 * an English name ("مساج الحامل 🍃 Air Cupping Massage"). Match on the bare
 * Arabic so those read as the same service rather than a delete plus an add.
 */
export function normalizeServiceName(name: string): string {
  return name
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
    .replace(/[a-z]/gi, "")
    .replace(/ـ/g, "")
    .replace(/[إأآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
}

/** "40 دقيقة", "ساعة و30 دقيقة", "ساعتين", "6 ساعات" — Rekaz's own phrasing. */
export function arabicServiceDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourText =
    hours === 0
      ? ""
      : hours === 1
        ? "ساعة"
        : hours === 2
          ? "ساعتين"
          : hours <= 10
            ? `${hours} ساعات`
            : `${hours} ساعة`;
  const minuteText = rest ? `${rest} ${rest <= 10 && rest > 2 ? "دقائق" : "دقيقة"}` : "";
  if (hourText && minuteText) return `${hourText} و${minuteText}`;
  return hourText || minuteText;
}

/**
 * What a row with no description says under its name. The public list names
 * no options, so this only says what the numbers can say on their own: a
 * massage priced by its length reads as a price per duration; options that
 * share a length (add-ons, sizes) collapse to a starting price.
 */
export function describeNewService(service: RekazService): string {
  const options = service.options.filter((option) => option.price != null);
  if (options.length <= 1) {
    const duration = (options[0] ?? service.options[0])?.durationMinutes;
    return duration ? `المدة: ${arabicServiceDuration(duration)}` : "";
  }
  const durations = options.map((option) => option.durationMinutes);
  const byLength =
    durations.every((minutes) => minutes != null) &&
    new Set(durations).size === durations.length;
  if (byLength) {
    return options
      .map((option) => `${arabicServiceDuration(option.durationMinutes!)} — ${option.price} ر.س`)
      .join("\n");
  }
  return `تبدأ الأسعار من ${Math.min(...options.map((option) => option.price!))} ر.س`;
}

/** Rekaz names carry stray double spaces; they are not a rename. */
export function cleanServiceName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

type Plan = {
  insert: RekazService[];
  update: { id: string; name: string; patch: Record<string, unknown>; changes: string[] }[];
  notOnRekaz: string[];
};

/**
 * Decide what a pull changes. Pure, so the matching rules can be tested
 * without Rekaz or the database.
 */
export function planCatalogSync(existing: CatalogRow[], services: RekazService[]): Plan {
  const byName = new Map<string, CatalogRow>();
  for (const row of existing) {
    const key = normalizeServiceName(row.name_ar ?? "");
    // The oldest row owns a name; a later duplicate is the one left over.
    if (key && !byName.has(key)) byName.set(key, row);
  }

  const plan: Plan = { insert: [], update: [], notOnRekaz: [] };
  const claimed = new Set<string>();
  const seen = new Set<string>();

  // Exact names first, so a loose match can never steal a row that another
  // service names outright ("قص الشعر" must not swallow "قص الشعر مدرجات").
  const ordered = [...services].sort(
    (a, b) =>
      Number(byName.has(normalizeServiceName(b.name))) -
      Number(byName.has(normalizeServiceName(a.name))),
  );

  /** The one existing row this service clearly renames, if there is exactly one. */
  const looseMatch = (key: string): CatalogRow | null => {
    const candidates = existing.filter((row) => {
      const other = normalizeServiceName(row.name_ar ?? "");
      if (!other || claimed.has(row.id)) return false;
      return other.startsWith(`${key} `) || key.startsWith(`${other} `);
    });
    return candidates.length === 1 ? candidates[0] : null;
  };

  for (const service of ordered) {
    const key = normalizeServiceName(service.name);
    if (!key || seen.has(key)) continue; // Rekaz can list a service twice.
    seen.add(key);

    const exact = byName.get(key);
    const current = exact && !claimed.has(exact.id) ? exact : looseMatch(key);
    if (!current) {
      plan.insert.push(service);
      continue;
    }
    claimed.add(current.id);

    const patch: Record<string, unknown> = {};
    const changes: string[] = [];
    if (cleanServiceName(current.name_ar ?? "") !== service.name) {
      patch.name_ar = service.name;
      changes.push("الاسم");
    }
    if (service.price != null && Number(current.price) !== service.price) {
      patch.price = service.price;
      changes.push("السعر");
    }
    // A service Rekaz files under no section keeps the one it has here.
    if (service.category && current.category !== service.category) {
      patch.category = service.category;
      changes.push("القسم");
    }
    if (service.imageUrl && current.image_url !== service.imageUrl) {
      patch.image_url = service.imageUrl;
      changes.push("الصورة");
    }
    if (current.is_available === false) {
      patch.is_available = true;
      changes.push("أُعيد إظهارها");
    }
    if (!current.description_ar?.trim()) {
      const description = describeNewService(service);
      if (description) {
        patch.description_ar = description;
        changes.push("الوصف");
      }
    }
    if (changes.length) {
      plan.update.push({ id: current.id, name: service.name, patch, changes });
    }
  }

  for (const row of existing) {
    if (!claimed.has(row.id) && row.is_available !== false) {
      plan.notOnRekaz.push(row.name_ar ?? "بدون اسم");
    }
  }
  return plan;
}

async function rekazGet<T>(path: string): Promise<T> {
  const response = await fetchWithTimeout(
    `${PLATFORM}${path}`,
    { headers: { __tenant: REKAZ_TENANT_ID, Accept: "application/json" }, cache: "no-store" },
    { timeoutMs: 20_000, label: "Rekaz catalogue" },
  );
  if (!response.ok) throw new Error(`Rekaz ${path} answered ${response.status}`);
  return (await response.json()) as T;
}

type RekazProduct = {
  id: string;
  name: string;
  typeString?: string;
  images?: string[];
  amount?: number | null;
  pricing?: { amount?: number | null; duration?: number | null }[];
};
type RekazCategory = {
  order?: number;
  localizedName?: { OtherLanguages?: Record<string, string> };
  productIds?: string[];
};

/** Read the salon's public service list, sections included. */
export async function fetchRekazServices(): Promise<RekazService[]> {
  const branches = await rekazGet<{ id: string }[]>("/branch/public-branches");
  const branchId = branches[0]?.id;
  if (!branchId) throw new Error("Rekaz lists no public branch");

  const query = `branchId=${encodeURIComponent(branchId)}`;
  const [products, categories] = await Promise.all([
    rekazGet<RekazProduct[]>(`/product/website-product-list?${query}`),
    rekazGet<RekazCategory[]>(`/product-category/website-list?${query}`),
  ]);
  if (!Array.isArray(products)) throw new Error("Rekaz returned no product list");

  const sectionOf = new Map<string, string>();
  for (const category of [...categories].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    const name = category.localizedName?.OtherLanguages?.ar?.trim();
    if (!name) continue;
    for (const id of category.productIds ?? []) {
      if (!sectionOf.has(id)) sectionOf.set(id, name);
    }
  }

  return products
    .filter((product) => product?.id && product.name?.trim())
    .map((product) => ({
      rekazId: product.id,
      name: cleanServiceName(product.name),
      price: product.amount ?? product.pricing?.[0]?.amount ?? null,
      options: (product.pricing ?? []).map((option) => ({
        price: option.amount ?? null,
        durationMinutes: option.duration ?? null,
      })),
      category: sectionOf.get(product.id) ?? null,
      imageUrl: product.images?.[0] ?? null,
      type: product.typeString ?? "Reservation",
    }));
}

/** Short and stable, so two racing pulls agree on which duplicate to keep. */
function rowOrder(row: CatalogRow): string {
  return `${row.created_at ?? ""}:${createHash("sha1").update(row.id).digest("hex")}`;
}

/** Pull Rekaz into `menu_items` and say what changed. */
export async function syncCatalogFromRekaz(): Promise<CatalogSyncResult> {
  const services = await fetchRekazServices();
  const admin = getAdminSupabaseClient();
  const cols = "id, name_ar, description_ar, price, category, image_url, is_available, created_at";

  const { data: existing, error } = await admin
    .from("menu_items")
    .select(cols)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const plan = planCatalogSync((existing ?? []) as CatalogRow[], services);
  const now = new Date().toISOString();

  for (const row of plan.update) {
    const { error: updateError } = await admin
      .from("menu_items")
      .update({ ...row.patch, updated_at: now })
      .eq("id", row.id)
      .eq("restaurant_id", KIARA_RESTAURANT_ID);
    if (updateError) throw new Error(updateError.message);
  }

  if (plan.insert.length) {
    const { error: insertError } = await admin.from("menu_items").insert(
      plan.insert.map((service) => ({
        restaurant_id: KIARA_RESTAURANT_ID,
        name_ar: service.name,
        description_ar: describeNewService(service),
        price: service.price,
        currency: "SAR",
        category: service.category ?? FALLBACK_CATEGORY,
        subcategory: service.type,
        image_url: service.imageUrl,
        is_available: true,
        sort_order: 0,
        crawled_at: now,
      })),
    );
    if (insertError) throw new Error(insertError.message);
    await hideRacedDuplicates(plan.insert.map((service) => service.name));
  }

  return {
    checkedAt: now,
    rekazCount: services.length,
    added: plan.insert.map((service) => service.name),
    updated: plan.update.map(({ name, changes }) => ({ name, changes })),
    notOnRekaz: plan.notOnRekaz,
  };
}

/**
 * Two people pressing the button together both see a new service as missing
 * and both insert it. There is no unique key on a service name to stop that,
 * so after inserting, keep the oldest row of each just-added name and hide the
 * rest — hidden, not deleted, like every other removal in this table.
 */
async function hideRacedDuplicates(names: string[]): Promise<void> {
  const admin = getAdminSupabaseClient();
  const { data, error } = await admin
    .from("menu_items")
    .select("id, name_ar, created_at, is_available")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .in("name_ar", names)
    .eq("is_available", true);
  if (error) throw new Error(error.message);

  const groups = new Map<string, CatalogRow[]>();
  for (const row of (data ?? []) as CatalogRow[]) {
    const key = normalizeServiceName(row.name_ar ?? "");
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const extras = [...groups.values()]
    .filter((rows) => rows.length > 1)
    .flatMap((rows) => [...rows].sort((a, b) => rowOrder(a).localeCompare(rowOrder(b))).slice(1))
    .map((row) => row.id);
  if (!extras.length) return;

  const { error: hideError } = await admin
    .from("menu_items")
    .update({ is_available: false, updated_at: new Date().toISOString() })
    .in("id", extras)
    .eq("restaurant_id", KIARA_RESTAURANT_ID);
  if (hideError) throw new Error(hideError.message);
}
