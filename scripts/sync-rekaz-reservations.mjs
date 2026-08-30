/**
 * Publish the Rekaz reservations snapshot where /orders can read it.
 *
 * No API key exists yet, so the export is browser-assisted (see
 * rekaz-reservations.txt) and this script does the server half: parse, fix the
 * timezone, and upload one JSON blob to the whatsapp-media bucket — chosen
 * because it needs no migration on the shared DB and re-uploading refreshes
 * prod without a deploy.
 *
 * It also fills in customer names for conversations that have none: the
 * reservation list carries the salon's own label for every booked customer.
 * Only null names are filled — a name someone typed by hand is never touched
 * (the aggressive pass lives in sync-rekaz-names.mjs).
 *
 *   node --env-file=.env.local scripts/sync-rekaz-reservations.mjs           # dry run
 *   node --env-file=.env.local scripts/sync-rekaz-reservations.mjs --apply   # upload
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const KIARA_RESTAURANT_ID = "2ba8f6c8-aff9-4147-8f13-cdcb732de698";
const BUCKET = "whatsapp-media";
const SNAPSHOT_PATH = `tenants/${KIARA_RESTAURANT_ID}/rekaz/reservations.json`;
const apply = process.argv.includes("--apply");

function normalizePhone(value) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("966") && digits.length > 6) digits = digits.slice(3);
  return digits.replace(/^0+/, "");
}

/**
 * Rekaz's `date` is a true UTC instant — an 11:00 Riyadh booking exports as
 * `08:00:00Z` — so it is kept as it comes. It used to be rewritten as +03:00
 * on the theory that the Z was a label on wall clock, which moved every
 * booking three hours early.
 */

/** "HH:MM:SS" pair → minutes, wrapping past midnight ("23:00" → "00:00"). */
function minutesBetween(startAt, endAt) {
  const toMin = (t) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  const diff = toMin(endAt) - toMin(startAt);
  return diff > 0 ? diff : diff + 24 * 60;
}

const rows = [];
for (const line of readFileSync(new URL("./rekaz-reservations.txt", import.meta.url), "utf8").split("\n")) {
  if (!line.trim() || line.startsWith("#")) continue;
  const [rn, date, startAt, endAt, product, priceName, customerName, mobile, providers, status, payment, amount, loc] =
    line.split("|");
  const [lat, lng, ...label] = (loc ?? "").split(",");
  rows.push({
    id: rn.trim(),
    arrivalAt: date.trim(),
    durationMinutes: minutesBetween(startAt.trim(), endAt.trim()),
    service: priceName.trim() || product.trim(),
    customerName: customerName.trim(),
    customerPhone: `+${String(mobile).replace(/\D/g, "")}`,
    providers: providers.split(",").map((p) => p.trim()).filter(Boolean),
    status: status.trim(), // Confirmed | Pending | Done
    payment: payment.trim(), // Paid | PartiallyPaid | Pending
    amount: Number(amount) || 0,
    location:
      lat && lng
        ? { lat: Number(lat), lng: Number(lng), label: label.join(",").trim() }
        : null,
  });
}

const snapshot = {
  syncedAt: new Date().toISOString(),
  reservations: rows.sort((a, b) => a.arrivalAt.localeCompare(b.arrivalAt)),
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// --- name fill (conservative: only conversations with no name at all) ------
const { data: conversations, error: convErr } = await supabase
  .from("conversations")
  .select("id, customer_phone, customer_name")
  .eq("restaurant_id", KIARA_RESTAURANT_ID)
  .is("customer_name", null);
if (convErr) throw new Error(convErr.message);

const nameByPhone = new Map();
for (const r of rows) {
  if (r.customerName) nameByPhone.set(normalizePhone(r.customerPhone), r.customerName);
}
const fills = (conversations ?? [])
  .map((c) => ({ id: c.id, phone: c.customer_phone, name: nameByPhone.get(normalizePhone(c.customer_phone)) }))
  .filter((f) => f.name);

console.log(`reservations: ${rows.length} | days: ${new Set(rows.map((r) => r.arrivalAt.slice(0, 10))).size}`);
console.log(`name fills for unnamed conversations: ${fills.length}`);
for (const f of fills) console.log(`  ${f.phone} → ${f.name}`);

if (!apply) {
  console.log("\ndry run — pass --apply to upload");
  process.exit(0);
}

const { error: upErr } = await supabase.storage
  .from(BUCKET)
  .upload(SNAPSHOT_PATH, JSON.stringify(snapshot), {
    contentType: "application/json",
    upsert: true,
  });
if (upErr) throw new Error(`upload failed: ${upErr.message}`);
console.log(`\nuploaded ${SNAPSHOT_PATH}`);

for (const f of fills) {
  const { error: e } = await supabase
    .from("conversations")
    .update({ customer_name: f.name })
    .eq("id", f.id)
    .eq("restaurant_id", KIARA_RESTAURANT_ID);
  if (e) console.error(`name fill failed for ${f.phone}: ${e.message}`);
}
console.log("done");
