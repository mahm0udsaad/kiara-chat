/**
 * Phase 5 — copy Kiara's whatsapp-media objects from the shared project to the
 * dedicated one. Data-plane only: needs the two service-role keys, no DB
 * password, so it can run before the schema exists on the target.
 *
 * Idempotent and resumable: it inventories the target first and skips anything
 * already there, so re-running after an interruption only moves what is left.
 *
 * Usage: node supabase/migration/copy-storage.mjs [--dry-run]
 */
import { readFileSync } from "node:fs";
import { writeFileSync } from "node:fs";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const DRY_RUN = process.argv.includes("--dry-run");

function readEnvFile(file) {
  const out = {};
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return out;
  }
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const mig = readEnvFile(path.join(HERE, ".env.migration"));
const local = readEnvFile(path.join(HERE, "..", "..", ".env.local"));

const SRC_URL = local.NEXT_PUBLIC_SUPABASE_URL;
const SRC_KEY = local.SUPABASE_SERVICE_ROLE_KEY;
const DST_URL = mig.TARGET_SUPABASE_URL;
const DST_KEY = mig.TARGET_SERVICE_ROLE_KEY;
const TENANT = mig.KIARA_RESTAURANT_ID;
const BUCKET = "whatsapp-media";

for (const [name, value] of Object.entries({ SRC_URL, SRC_KEY, DST_URL, DST_KEY, TENANT })) {
  if (!value) {
    console.error(`Missing ${name} — check .env.migration and ../../.env.local`);
    process.exit(1);
  }
}

const headers = (key, extra = {}) => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  ...extra,
});

/** Storage list is one directory level at a time; folders come back with id === null. */
async function listAll(url, key, prefix) {
  const found = [];
  const queue = [prefix];
  while (queue.length) {
    const dir = queue.shift();
    let offset = 0;
    for (;;) {
      const res = await fetch(`${url}/storage/v1/object/list/${BUCKET}`, {
        method: "POST",
        headers: headers(key, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          prefix: dir,
          limit: 1000,
          offset,
          sortBy: { column: "name", order: "asc" },
        }),
      });
      if (!res.ok) throw new Error(`list ${dir} → ${res.status} ${await res.text()}`);
      const rows = await res.json();
      if (!rows.length) break;
      for (const row of rows) {
        const full = dir ? `${dir}/${row.name}` : row.name;
        if (row.id === null) queue.push(full);
        else found.push({ path: full, size: row.metadata?.size ?? 0 });
      }
      if (rows.length < 1000) break;
      offset += rows.length;
    }
  }
  return found;
}

async function ensureBucket() {
  const res = await fetch(`${DST_URL}/storage/v1/bucket`, {
    method: "POST",
    headers: headers(DST_KEY, { "Content-Type": "application/json" }),
    // Mirrors the source: private. Reads go through short-lived signed URLs
    // minted server-side (src/app/api/media/route.ts), never public URLs.
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }),
  });
  if (res.ok) return "created";
  const body = await res.text();
  if (res.status === 409 || body.includes("already exists")) return "exists";
  throw new Error(`create bucket → ${res.status} ${body}`);
}

async function copyOne(obj) {
  const encoded = obj.path.split("/").map(encodeURIComponent).join("/");
  const get = await fetch(`${SRC_URL}/storage/v1/object/${BUCKET}/${encoded}`, {
    headers: headers(SRC_KEY),
  });
  if (!get.ok) throw new Error(`download ${obj.path} → ${get.status}`);
  const body = Buffer.from(await get.arrayBuffer());
  const contentType = get.headers.get("content-type") ?? "application/octet-stream";

  const put = await fetch(`${DST_URL}/storage/v1/object/${BUCKET}/${encoded}`, {
    method: "POST",
    headers: headers(DST_KEY, {
      "Content-Type": contentType,
      "x-upsert": "true",
      "cache-control": "3600",
    }),
    body,
  });
  if (!put.ok) throw new Error(`upload ${obj.path} → ${put.status} ${await put.text()}`);
  return body.byteLength;
}

async function withRetry(fn, label, attempts = 4) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    }
  }
  throw new Error(`${label}: ${lastErr.message}`);
}

const main = async () => {
  console.log(`Source : ${SRC_URL}`);
  console.log(`Target : ${DST_URL}`);
  console.log(`Bucket : ${BUCKET}  prefix: ${TENANT}/\n`);

  console.log(`bucket: ${DRY_RUN ? "(dry-run, skipped)" : await ensureBucket()}`);

  const source = await listAll(SRC_URL, SRC_KEY, TENANT);
  const totalBytes = source.reduce((n, o) => n + Number(o.size || 0), 0);
  console.log(`source: ${source.length} objects, ${(totalBytes / 1e6).toFixed(1)} MB`);

  const existing = DRY_RUN ? [] : await listAll(DST_URL, DST_KEY, TENANT);
  const have = new Set(existing.map((o) => o.path));
  const todo = source.filter((o) => !have.has(o.path));
  console.log(`target: ${have.size} already present → ${todo.length} to copy\n`);

  writeFileSync(
    path.join(HERE, "storage-manifest.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), bucket: BUCKET, objects: source }, null, 2),
  );

  if (DRY_RUN) {
    console.log("dry run — nothing copied. Manifest written.");
    return;
  }

  let done = 0;
  let bytes = 0;
  const failures = [];
  const CONCURRENCY = 6;
  const queue = [...todo];

  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (;;) {
        const obj = queue.shift();
        if (!obj) return;
        try {
          // Resolve first, then add. `bytes += await …` reads bytes before
          // suspending, so concurrent workers overwrite each other's total.
          const copied = await withRetry(() => copyOne(obj), obj.path);
          bytes += copied;
        } catch (err) {
          failures.push({ path: obj.path, error: err.message });
        }
        done += 1;
        if (done % 50 === 0 || done === todo.length) {
          process.stdout.write(`  ${done}/${todo.length}  ${(bytes / 1e6).toFixed(1)} MB\n`);
        }
      }
    }),
  );

  // Re-list the target rather than trusting the copy loop, and compare sizes —
  // a truncated upload still produces an object, so object count alone would
  // report success on a corrupt copy.
  const after = await listAll(DST_URL, DST_KEY, TENANT);
  const srcSizes = new Map(source.map((o) => [o.path, Number(o.size || 0)]));
  const dstSizes = new Map(after.map((o) => [o.path, Number(o.size || 0)]));
  const missing = [...srcSizes.keys()].filter((k) => !dstSizes.has(k));
  const wrongSize = [...srcSizes].filter(([k, v]) => dstSizes.has(k) && dstSizes.get(k) !== v);
  const total = (m) => [...m.values()].reduce((a, b) => a + b, 0);

  console.log(`\ncopied ${done - failures.length}/${todo.length}`);
  console.log(`source: ${srcSizes.size} objects, ${(total(srcSizes) / 1e6).toFixed(2)} MB`);
  console.log(`target: ${dstSizes.size} objects, ${(total(dstSizes) / 1e6).toFixed(2)} MB`);
  console.log(`missing: ${missing.length}   size mismatches: ${wrongSize.length}`);
  for (const [k, v] of wrongSize.slice(0, 10)) {
    console.log(`  ${k}: source ${v} vs target ${dstSizes.get(k)}`);
  }
  if (missing.length || wrongSize.length) process.exitCode = 1;
  if (failures.length) {
    console.log(`\n${failures.length} FAILED:`);
    for (const f of failures.slice(0, 20)) console.log(`  ${f.path} — ${f.error}`);
    writeFileSync(path.join(HERE, "storage-failures.json"), JSON.stringify(failures, null, 2));
    process.exitCode = 1;
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
