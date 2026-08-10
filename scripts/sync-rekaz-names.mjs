/**
 * Name Kiara's conversations from the Rekaz customer directory, matched on the
 * phone number.
 *
 * WhatsApp only ever gives us the pushName the customer set on their own phone
 * — "M", "♥️", nothing at all — while Rekaz holds the salon's own label, which
 * usually carries the district ("حصه الفيصلية"). That label is what staff
 * recognise, so Rekaz wins wherever the two disagree.
 *
 *   node --env-file=.env.local scripts/sync-rekaz-names.mjs           # dry run
 *   node --env-file=.env.local scripts/sync-rekaz-names.mjs --apply   # write
 *
 * Refreshing the data means re-exporting from the platform: the customer API
 * needs a browser session's antiforgery token, so there is no server-side pull
 * until Rekaz's API-keys integration is enabled.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const KIARA_RESTAURANT_ID = "2ba8f6c8-aff9-4147-8f13-cdcb732de698";
const apply = process.argv.includes("--apply");

/** `+966 50 237 6231`, `0502376231` and `502376231` all reduce to the same key. */
function normalizePhone(value) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("966") && digits.length > 6) digits = digits.slice(3);
  return digits.replace(/^0+/, "");
}

const { customers } = JSON.parse(
  readFileSync(new URL("./rekaz-customer-names.json", import.meta.url), "utf8")
);
const byPhone = new Map();
for (const c of customers) {
  const key = normalizePhone(c.phone);
  if (key && c.name?.trim()) byPhone.set(key, c.name.trim());
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const { data: conversations, error } = await supabase
  .from("conversations")
  .select("id, customer_phone, customer_name")
  .eq("restaurant_id", KIARA_RESTAURANT_ID);
if (error) throw new Error(error.message);

const plan = [];
for (const conv of conversations) {
  const name = byPhone.get(normalizePhone(conv.customer_phone));
  if (!name || name === conv.customer_name) continue;
  plan.push({ id: conv.id, phone: conv.customer_phone, from: conv.customer_name, to: name });
}

console.log(`directory: ${byPhone.size} customers | conversations: ${conversations.length}`);
console.log(`\n== rename (${plan.length}) ==`);
for (const row of plan) {
  console.log(`  ${row.phone}: ${row.from ?? "(بلا اسم)"} → ${row.to}`);
}

if (!plan.length) {
  console.log("\nnothing to do");
  process.exit(0);
}
if (!apply) {
  console.log("\ndry run — pass --apply to write");
  process.exit(0);
}

for (const row of plan) {
  const { error: e } = await supabase
    .from("conversations")
    .update({ customer_name: row.to })
    .eq("id", row.id)
    .eq("restaurant_id", KIARA_RESTAURANT_ID);
  if (e) console.error(`failed for ${row.phone}: ${e.message}`);
}
console.log("\napplied");
