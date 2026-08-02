/**
 * Read-only probe: what columns does the shared `menu_items` table actually
 * have, and what is in Kiara's slice of it right now? Run with:
 *   node --env-file=.env.local scripts/inspect-menu-items.mjs
 */
import { createClient } from "@supabase/supabase-js";

const KIARA_RESTAURANT_ID = "2ba8f6c8-aff9-4147-8f13-cdcb732de698";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const { data, error } = await supabase
  .from("menu_items")
  .select("*")
  .eq("restaurant_id", KIARA_RESTAURANT_ID)
  .order("category")
  .limit(500);

if (error) {
  console.error("query failed:", error.message);
  process.exit(1);
}

console.log("rows:", data.length);
console.log("columns:", Object.keys(data[0] ?? {}).join(", "));
const byCategory = {};
for (const row of data) byCategory[row.category ?? "—"] = (byCategory[row.category ?? "—"] ?? 0) + 1;
console.log("categories:", JSON.stringify(byCategory, null, 2));
console.log("sample row:", JSON.stringify(data[0], null, 2));
