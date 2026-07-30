/**
 * Kiara's service catalogue — the 79 `menu_items` rows the parent app crawled
 * from the spa's price list: packages (البكجات), massages, nails, skin, hair,
 * gifts, each with a price and an explanation.
 *
 * This is the SAME table the bot's menu context reads, so editing an item here
 * corrects it everywhere at once. Rows are hidden with `is_available` rather
 * than deleted — a removed row would silently vanish from the parent app's
 * knowledge too, and hiding is reversible.
 *
 * The service-role client is used because RLS on this parent-app table doesn't
 * admit Kiara's team members; the routes gate reads to members and writes to
 * admins.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";

const COLS =
  "id, name_ar, name_en, description_ar, price, currency, category, is_available, sort_order";

export interface CatalogItem {
  id: string;
  name: string;
  description: string;
  price: number | null;
  currency: string;
  category: string;
  isAvailable: boolean;
}

/**
 * The crawl left Excel's carriage-return escapes in some descriptions
 * ("_x000d_"). Strip them here so neither the composer nor WhatsApp shows them.
 */
function clean(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/_x000d_/gi, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function toItem(row: Record<string, unknown>): CatalogItem {
  return {
    id: row.id as string,
    name: clean((row.name_ar as string) || (row.name_en as string)) || "بدون اسم",
    description: clean(row.description_ar as string),
    price: row.price == null ? null : Number(row.price),
    currency: (row.currency as string) || "SAR",
    category: clean(row.category as string) || "أخرى",
    isAvailable: row.is_available !== false,
  };
}

export async function listCatalog(
  opts: { availableOnly?: boolean } = {}
): Promise<CatalogItem[]> {
  let query = getAdminSupabaseClient()
    .from("menu_items")
    .select(COLS)
    .eq("restaurant_id", KIARA_RESTAURANT_ID);
  if (opts.availableOnly) query = query.eq("is_available", true);

  const { data, error } = await query
    .order("category")
    .order("sort_order", { nullsFirst: false })
    .order("name_ar");
  if (error) throw new Error(error.message);
  return (data ?? []).map(toItem);
}

export interface CatalogPatch {
  name?: string;
  description?: string;
  price?: number | null;
  category?: string;
  isAvailable?: boolean;
}

export async function updateCatalogItem(
  id: string,
  patch: CatalogPatch
): Promise<CatalogItem> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) update.name_ar = patch.name.trim();
  if (patch.description !== undefined) update.description_ar = patch.description.trim();
  if (patch.price !== undefined) update.price = patch.price;
  if (patch.category !== undefined) update.category = patch.category.trim();
  if (patch.isAvailable !== undefined) update.is_available = patch.isAvailable;

  const { data, error } = await getAdminSupabaseClient()
    .from("menu_items")
    .update(update)
    .eq("id", id)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .select(COLS)
    .single();
  if (error) throw new Error(error.message);
  return toItem(data);
}

export async function createCatalogItem(input: {
  name: string;
  description: string;
  price: number | null;
  category: string;
}): Promise<CatalogItem> {
  const { data, error } = await getAdminSupabaseClient()
    .from("menu_items")
    .insert({
      restaurant_id: KIARA_RESTAURANT_ID,
      name_ar: input.name.trim(),
      description_ar: input.description.trim(),
      price: input.price,
      category: input.category.trim() || "أخرى",
      currency: "SAR",
      is_available: true,
    })
    .select(COLS)
    .single();
  if (error) throw new Error(error.message);
  return toItem(data);
}

/** The WhatsApp text a staff member drops into the composer for one item. */
export function formatCatalogItem(item: CatalogItem): string {
  const price =
    item.price == null ? "" : ` — ${item.price.toLocaleString("ar-SA")} ر.س`;
  return item.description
    ? `${item.name}${price}\n${item.description}`
    : `${item.name}${price}`;
}
