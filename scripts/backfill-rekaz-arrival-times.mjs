/**
 * One-off: undo the three-hour shift in the Rekaz arrival times.
 *
 * Rekaz's `date` is a true UTC instant — an 11:00 Riyadh booking arrives as
 * `08:00:00Z` — but the adapter read that `Z` as a label on Riyadh wall clock
 * and rewrote it as `+03:00`, storing every booking three hours early. The
 * stored digits are therefore already correct; only the offset on them is
 * wrong, so the repair is `+03:00` → `Z`, which moves `arrival_at` forward
 * three hours. `src/lib/rekaz.ts` no longer does the rewrite, so this is
 * needed exactly once, for the rows written before that fix.
 *
 * Idempotent: a payload whose `arrivalAt` already ends in `Z` is left alone,
 * so a second run reports zero changes rather than shifting anything twice.
 *
 * `driver_orders` rows carry a copy of the reservation's arrival time. Only
 * the ones with a `rekaz_source_id` inherited the shift and are moved here;
 * rows entered by hand in the dashboard were never Rekaz's to get wrong.
 *
 *   node --env-file=.env.local scripts/backfill-rekaz-arrival-times.mjs
 *   node --env-file=.env.local scripts/backfill-rekaz-arrival-times.mjs --apply
 */
import { createHash } from "node:crypto";

const KIARA_RESTAURANT_ID = "2ba8f6c8-aff9-4147-8f13-cdcb732de698";
const SHIFT_MS = 3 * 60 * 60 * 1000;
const PAGE = 500;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const apply = process.argv.includes("--apply");

if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
};

/** Same shape the sync hashes with, so a repaired row still matches Rekaz. */
function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
    .join(",")}}`;
}

const payloadHash = (payload) =>
  createHash("sha256").update(canonicalJson(payload)).digest("hex");

const riyadh = new Intl.DateTimeFormat("ar-EG", {
  timeZone: "Asia/Riyadh",
  dateStyle: "short",
  timeStyle: "short",
});

async function readAll(path) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const res = await fetch(`${url}/rest/v1/${path}&limit=${PAGE}&offset=${offset}`, { headers });
    const page = await res.json();
    if (!Array.isArray(page)) throw new Error(`${res.status} ${JSON.stringify(page)}`);
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

async function patch(path, body) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
}

const reservations = await readAll(
  `rekaz_reservations?select=source_id,arrival_at,payload&restaurant_id=eq.${KIARA_RESTAURANT_ID}&order=source_id.asc`,
);
console.log(`rekaz_reservations: ${reservations.length} rows`);

let moved = 0;
let alreadyRight = 0;
const samples = [];
for (const row of reservations) {
  const payload = row.payload ?? {};
  const current = String(payload.arrivalAt ?? "");
  if (!current.endsWith("+03:00")) {
    alreadyRight += 1;
    continue;
  }
  const corrected = `${current.slice(0, -6)}Z`;
  const nextPayload = { ...payload, arrivalAt: corrected };
  if (samples.length < 5) {
    samples.push(
      `  ${row.source_id}  ${riyadh.format(new Date(row.arrival_at))} → ${riyadh.format(new Date(corrected))}  ${payload.customerName ?? ""}`,
    );
  }
  if (apply) {
    await patch(
      `rekaz_reservations?restaurant_id=eq.${KIARA_RESTAURANT_ID}&source_id=eq.${encodeURIComponent(row.source_id)}`,
      { arrival_at: corrected, payload: nextPayload, payload_hash: payloadHash(nextPayload) },
    );
  }
  moved += 1;
}
console.log(samples.join("\n"));
console.log(`  ${apply ? "moved" : "would move"} ${moved}, already correct ${alreadyRight}`);

const orders = await readAll(
  `driver_orders?select=id,arrival_at,rekaz_source_id&restaurant_id=eq.${KIARA_RESTAURANT_ID}&rekaz_source_id=not.is.null&order=arrival_at.asc`,
);
console.log(`driver_orders from Rekaz: ${orders.length} rows`);

for (const order of orders) {
  const corrected = new Date(Date.parse(order.arrival_at) + SHIFT_MS).toISOString();
  if (apply) await patch(`driver_orders?id=eq.${order.id}`, { arrival_at: corrected });
}
console.log(
  `  ${apply ? "moved" : "would move"} ${orders.length} (hand-entered orders left untouched)`,
);

if (!apply) console.log("\nDry run. Re-run with --apply to write.");
