/**
 * One-off: fold every customer who was split across several chats back into one.
 *
 * Before 2026-10-28 a slow database could make the thread lookup fail, and the
 * webhook read that as "new customer" and opened another chat. Two employees
 * then answered the same woman in two threads that never met. The lookup is
 * fixed (find_or_create_conversation); this repairs the numbers it already
 * split.
 *
 * For each number with more than one thread:
 *  - the thread with the latest message is kept — that is where the team is
 *    working now;
 *  - every message, order, call, note, label, claim and audit entry of the
 *    others moves onto it;
 *  - the kept thread takes the earliest start, the latest activity and the sum
 *    of unread counts, and gains anything in the others' metadata it lacks;
 *  - the emptied threads are deleted. Each one's full row is written first to
 *    a local backup file and into the audit trail (`conversation.merged`), so
 *    nothing is lost.
 *
 * Dry run by default: prints what it would do and writes nothing.
 *
 *   node --env-file=.env.local scripts/merge-split-conversations.mjs
 *   node --env-file=.env.local scripts/merge-split-conversations.mjs --apply
 *
 * Safe to run twice: a second run finds no split numbers and does nothing.
 */
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const KIARA_RESTAURANT_ID = "2ba8f6c8-aff9-4147-8f13-cdcb732de698";

/** Tables whose rows belong to a thread through `conversation_id`. */
export const CHILD_TABLES = [
  "messages",
  "driver_orders",
  "orders",
  "calls",
  "conversation_internal_notes",
  "conversation_claim_events",
  "sla_notification_log",
];

const time = (value) => (value ? Date.parse(value) : 0);

/**
 * Which thread of one number survives: the one with the latest message, then
 * the one with more messages, then the newest.
 */
export function pickKeeper(threads, messageCounts = {}) {
  return [...threads].sort(
    (a, b) =>
      time(b.last_message_at) - time(a.last_message_at) ||
      (messageCounts[b.id] ?? 0) - (messageCounts[a.id] ?? 0) ||
      time(b.started_at) - time(a.started_at),
  )[0];
}

/** Group a tenant's threads by address; only numbers with more than one. */
export function splitNumbers(threads) {
  const byPhone = new Map();
  for (const thread of threads) {
    if (!thread.customer_phone) continue;
    const list = byPhone.get(thread.customer_phone) ?? [];
    list.push(thread);
    byPhone.set(thread.customer_phone, list);
  }
  return [...byPhone.entries()].filter(([, list]) => list.length > 1);
}

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * The kept thread's new fields. Its own values win; the others only fill what
 * it lacks, and field sessions (one per order) are unioned so no order loses
 * its driver and specialist progress.
 *
 * The name is the exception: a name the team typed («روز/الفهد الشمالي») beats
 * whatever WhatsApp name happened to land on the kept thread, so the newest
 * rename across all of them wins when there is one.
 */
export function keeperPatch(keeper, retired, { renamedTo = null } = {}) {
  const all = [keeper, ...retired];
  const earliest = (field) =>
    all.map((t) => t[field]).filter(Boolean).sort((a, b) => time(a) - time(b))[0] ?? null;
  const latest = (field) =>
    all.map((t) => t[field]).filter(Boolean).sort((a, b) => time(b) - time(a))[0] ?? null;

  const own = isPlainObject(keeper.metadata) ? keeper.metadata : {};
  const metadata = {};
  // Oldest first, so a newer thread's value beats an older one's.
  for (const thread of [...retired].sort((a, b) => time(a.started_at) - time(b.started_at))) {
    if (isPlainObject(thread.metadata)) Object.assign(metadata, thread.metadata);
  }
  Object.assign(metadata, own);
  const sessions = {};
  for (const thread of [...retired, keeper]) {
    const value = isPlainObject(thread.metadata) ? thread.metadata.field_sessions : null;
    if (isPlainObject(value)) Object.assign(sessions, value);
  }
  if (Object.keys(sessions).length) metadata.field_sessions = sessions;
  metadata.merged_from = [
    ...(Array.isArray(own.merged_from) ? own.merged_from : []),
    ...retired.map((t) => t.id),
  ];

  return {
    started_at: earliest("started_at"),
    last_message_at: latest("last_message_at"),
    last_inbound_at: latest("last_inbound_at"),
    unread_count: all.reduce((sum, t) => sum + (Number(t.unread_count) || 0), 0),
    customer_name:
      renamedTo || keeper.customer_name || all.find((t) => t.customer_name)?.customer_name || null,
    metadata,
  };
}

// ---------------------------------------------------------------------------

function client(url, key, fetchImpl = fetch) {
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  const call = async (method, path, body, extra = {}) => {
    const response = await fetchImpl(`${url}/rest/v1/${path}`, {
      method,
      headers: { ...headers, ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${path.split("?")[0]} → ${response.status} ${text}`);
    return text ? JSON.parse(text) : null;
  };
  return {
    get: async (path) => {
      const rows = [];
      for (let offset = 0; ; offset += 1000) {
        const page = await call("GET", `${path}${path.includes("?") ? "&" : "?"}offset=${offset}&limit=1000`);
        rows.push(...page);
        if (page.length < 1000) return rows;
      }
    },
    count: async (path) => {
      const response = await fetchImpl(`${url}/rest/v1/${path}`, {
        headers: { ...headers, Prefer: "count=exact", Range: "0-0" },
      });
      if (!response.ok) throw new Error(`count ${path.split("?")[0]} → ${response.status}`);
      return Number(response.headers.get("content-range")?.split("/")[1] ?? 0);
    },
    patch: (path, body) => call("PATCH", path, body, { Prefer: "return=minimal" }),
    post: (path, body, prefer = "return=minimal") => call("POST", path, body, { Prefer: prefer }),
    del: (path) => call("DELETE", path, undefined, { Prefer: "return=minimal" }),
  };
}

const inList = (ids) => `in.(${ids.join(",")})`;

/** The name the team most recently typed for any of these threads. */
async function latestRename(db, tenant, ids) {
  const events = await db.get(
    `operation_events?select=payload,occurred_at&${tenant}&aggregate_type=eq.conversation` +
      `&event_type=eq.conversation.customer_renamed&aggregate_id=${inList(ids)}&order=occurred_at.desc`,
  );
  const name = events[0]?.payload?.to;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

export async function run({ url, key, apply, fetchImpl = fetch, log = console.log, warn = console.warn, backupDir = "." }) {
  if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  const db = client(url, key, fetchImpl);
  const console = { log, warn };
  const tenant = `restaurant_id=eq.${KIARA_RESTAURANT_ID}`;

  const threads = await db.get(`conversations?select=*&${tenant}&order=started_at`);
  const groups = splitNumbers(threads);
  console.log(`${groups.length} numbers split across ${groups.reduce((n, [, l]) => n + l.length - 1, 0)} extra threads.`);
  if (!groups.length) return;

  const backup = [];
  const backupFile = `${backupDir}/merge-split-conversations-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  let done = 0;
  for (const [phone, list] of groups) {
    const ids = list.map((t) => t.id);
    const counts = {};
    for (const id of ids) counts[id] = await db.count(`messages?select=id&conversation_id=eq.${id}`);
    const keeper = pickKeeper(list, counts);
    const retired = list.filter((t) => t.id !== keeper.id);
    const retiredIds = retired.map((t) => t.id);
    const orders = await db.count(`driver_orders?select=id&conversation_id=${inList(retiredIds)}`);
    const renamedTo = await latestRename(db, tenant, ids);

    const label = (t) => `${t.customer_name || "بدون اسم"} (${counts[t.id]} رسالة, آخرها ${t.last_message_at?.slice(0, 16) ?? "-"})`;
    console.log(`\n…${phone.slice(-4)}  keep: ${label(keeper)}`);
    if (renamedTo && renamedTo !== keeper.customer_name) console.log(`        name → ${renamedTo}`);
    for (const t of retired) console.log(`        fold: ${label(t)}`);
    if (orders) console.log(`        + ${orders} driver order(s) move over`);
    if (!apply) continue;

    // Saved before anything changes, so a run that stops halfway still has it.
    backup.push({ phone, keeper: keeper.id, retired });
    writeFileSync(backupFile, JSON.stringify(backup, null, 2));

    for (const table of CHILD_TABLES) {
      await db.patch(`${table}?conversation_id=${inList(retiredIds)}`, { conversation_id: keeper.id });
    }
    // Labels are keyed on (conversation, label): copy what the kept thread
    // lacks, then drop the others' rows.
    const labels = await db.get(`conversation_label_assignments?select=*&conversation_id=${inList(retiredIds)}`);
    if (labels.length) {
      await db.post(
        "conversation_label_assignments?on_conflict=conversation_id,label_id",
        labels.map((row) => ({ ...row, conversation_id: keeper.id })),
        "resolution=ignore-duplicates,return=minimal",
      );
      await db.del(`conversation_label_assignments?conversation_id=${inList(retiredIds)}`);
    }
    // History follows the thread, so the audit report shows one story.
    await db
      .patch(
        `operation_events?${tenant}&aggregate_type=eq.conversation&aggregate_id=${inList(retiredIds)}`,
        { aggregate_id: keeper.id },
      )
      .catch((error) => console.warn(`        audit history not moved: ${error.message}`));

    await db.patch(`conversations?id=eq.${keeper.id}&${tenant}`, keeperPatch(keeper, retired, { renamedTo }));
    await db.post("operation_events", {
      restaurant_id: KIARA_RESTAURANT_ID,
      aggregate_type: "conversation",
      aggregate_id: keeper.id,
      event_type: "conversation.merged",
      actor_type: "system",
      actor_role: "system",
      payload: { reason: "split_by_failed_lookup", retired },
    });

    // Delete only threads with nothing left on them.
    for (const id of retiredIds) {
      let left = 0;
      for (const table of [...CHILD_TABLES, "conversation_label_assignments"]) {
        left += await db.count(`${table}?select=conversation_id&conversation_id=eq.${id}`);
      }
      if (left) {
        console.warn(`        kept ${id}: ${left} row(s) still point at it`);
        continue;
      }
      await db.del(`conversations?id=eq.${id}&${tenant}`);
    }
    done += 1;
  }

  if (apply) {
    console.log(`\nMerged ${done} numbers. Deleted threads backed up to ${backupFile}.`);
  } else {
    console.log("\nDry run — nothing written. Re-run with --apply to merge.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    apply: process.argv.includes("--apply"),
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
