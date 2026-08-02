/**
 * Refresh Kiara's `menu_items` from the live Rekaz service list.
 *
 * The rows in the shared table were crawled in April and have drifted: prices
 * changed, services were added, categories were renamed. `scripts/rekaz-services.txt`
 * is the current list, read straight off platform.rekaz.io/products.
 *
 * Matching is by normalized Arabic name (emoji, tatweel and spacing vary between
 * the crawl and the platform). A service that no longer exists in Rekaz is
 * hidden (`is_available = false`), never deleted — the same table feeds the
 * parent app's knowledge base.
 *
 *   node --env-file=.env.local scripts/sync-rekaz-catalog.mjs           # dry run
 *   node --env-file=.env.local scripts/sync-rekaz-catalog.mjs --apply   # write
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const KIARA_RESTAURANT_ID = "2ba8f6c8-aff9-4147-8f13-cdcb732de698";
const CDN = "https://cdn.rekaz.io/tenants/3a1f3638-e6dc-d864-4aa7-df60cdbb1146";
/** Rekaz's "no section chosen" placeholder is not a category worth showing. */
const NO_CATEGORY = "اختر القسم";
const FALLBACK_CATEGORY = "خدمات أخرى";

const apply = process.argv.includes("--apply");

/**
 * Emoji, tatweel, wrapping dashes and spacing all differ between the April
 * crawl and today's Rekaz list, and several services have since gained an
 * English name ("مساج الحامل 🍃 Air Cupping Massage"). Match on the bare
 * Arabic so those read as the same service rather than a delete plus an add.
 */
function normalize(name) {
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

function parseSource(path) {
  const rows = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [name, type, categories, status, imageId, options = ""] = line.split("|");
    rows.push({
      name: name.trim(),
      type: type.trim(),
      categories: categories.split(",").map((c) => c.trim()).filter((c) => c && c !== "+4"),
      status: status.trim(),
      imageUrl: imageId.trim() ? `${CDN}/${imageId.trim()}.webp` : null,
      options: options
        .split(";")
        .filter(Boolean)
        .map((opt) => {
          const [label, price, duration] = opt.split("~");
          return { label: label.trim(), price: Number(price), duration: (duration ?? "").trim() };
        })
        .filter((o) => Number.isFinite(o.price)),
    });
  }
  return rows;
}

/**
 * The composer pastes this under the name, so it reads as a price list: only
 * the variants worth choosing between, one per line.
 */
function describe(row) {
  const named = row.options.filter((o) => o.label && normalize(o.label) !== normalize(row.name));
  const lines = named.map((o) =>
    [o.label, `${o.price} ر.س`, o.duration].filter(Boolean).join(" · ")
  );
  const base = row.options[0];
  if (base && !base.label && base.duration) lines.unshift(`المدة: ${base.duration}`);
  return lines.join("\n");
}

const source = parseSource(new URL("./rekaz-services.txt", import.meta.url));
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const { data: existing, error } = await supabase
  .from("menu_items")
  .select("id, name_ar, description_ar, price, category, image_url, is_available")
  .eq("restaurant_id", KIARA_RESTAURANT_ID);
if (error) throw new Error(error.message);

const byName = new Map();
for (const row of existing) byName.set(normalize(row.name_ar ?? ""), row);

const plan = { update: [], insert: [], hide: [] };
const seen = new Set();
const claimed = new Set();

// Exact names first, so a loose match can never steal a row that a source
// service names outright ("قص الشعر" must not swallow "قص الشعر مدرجات").
const ordered = [...source].sort((a, b) =>
  Number(byName.has(normalize(b.name))) - Number(byName.has(normalize(a.name)))
);

/** The one existing row this service clearly renames, if there is exactly one. */
function looseMatch(key) {
  const candidates = existing.filter((row) => {
    const other = normalize(row.name_ar ?? "");
    if (!other || claimed.has(row.id)) return false;
    return other === key || other.startsWith(`${key} `) || key.startsWith(`${other} `);
  });
  return candidates.length === 1 ? candidates[0] : null;
}

for (const row of ordered) {
  const key = normalize(row.name);
  if (seen.has(key)) continue; // Rekaz lists a couple of services twice.
  seen.add(key);

  const category = row.categories.find((c) => c && c !== NO_CATEGORY) ?? FALLBACK_CATEGORY;
  const price = row.options[0]?.price ?? null;
  const description = describe(row);
  const exact = byName.get(key);
  const current = exact && !claimed.has(exact.id) ? exact : looseMatch(key);
  if (current) claimed.add(current.id);

  if (!current) {
    plan.insert.push({
      restaurant_id: KIARA_RESTAURANT_ID,
      name_ar: row.name,
      description_ar: description,
      price,
      currency: "SAR",
      category,
      subcategory: row.type,
      image_url: row.imageUrl,
      is_available: true,
      sort_order: 0,
    });
    continue;
  }

  const patch = {};
  // Rekaz is the source of truth for the name too — the crawl's "- x - 🍃"
  // shapes and pre-rename titles should not outlive it.
  if (current.name_ar !== row.name) patch.name_ar = row.name;
  if (price != null && Number(current.price) !== price) patch.price = price;
  if (current.category !== category) patch.category = category;
  if (row.imageUrl && current.image_url !== row.imageUrl) patch.image_url = row.imageUrl;
  // Never blank a description the crawl captured; only replace it with a real one.
  if (description && current.description_ar !== description) patch.description_ar = description;
  if (current.is_available === false) patch.is_available = true;
  if (Object.keys(patch).length) plan.update.push({ id: current.id, name: current.name_ar, patch });
}

for (const row of existing) {
  if (!claimed.has(row.id) && row.is_available !== false) {
    plan.hide.push({ id: row.id, name: row.name_ar });
  }
}

console.log(`source: ${source.length} services (${seen.size} unique)`);
console.log(`existing: ${existing.length} rows`);
console.log(`\n== insert (${plan.insert.length}) ==`);
for (const r of plan.insert) console.log(`  + ${r.name_ar} — ${r.price} ر.س — ${r.category}`);
console.log(`\n== update (${plan.update.length}) ==`);
for (const r of plan.update) console.log(`  ~ ${r.name}: ${Object.keys(r.patch).join(", ")}`);
console.log(`\n== hide (${plan.hide.length}) ==`);
for (const r of plan.hide) console.log(`  - ${r.name}`);

if (!apply) {
  console.log("\ndry run — pass --apply to write");
  process.exit(0);
}

for (const row of plan.update) {
  const { error: e } = await supabase
    .from("menu_items")
    .update({ ...row.patch, updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("restaurant_id", KIARA_RESTAURANT_ID);
  if (e) console.error(`update failed for ${row.name}: ${e.message}`);
}
if (plan.insert.length) {
  const { error: e } = await supabase.from("menu_items").insert(plan.insert);
  if (e) console.error(`insert failed: ${e.message}`);
}
for (const row of plan.hide) {
  const { error: e } = await supabase
    .from("menu_items")
    .update({ is_available: false, updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("restaurant_id", KIARA_RESTAURANT_ID);
  if (e) console.error(`hide failed for ${row.name}: ${e.message}`);
}
console.log("\napplied");
