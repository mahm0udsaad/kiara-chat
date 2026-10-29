import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  keeperPatch,
  pickKeeper,
  run,
  splitNumbers,
  KIARA_RESTAURANT_ID as T,
} from "../scripts/merge-split-conversations.mjs";

test("the thread with the latest message is kept", () => {
  const threads = [
    { id: "old", started_at: "2026-10-17T19:00:00Z", last_message_at: "2026-10-27T19:26:00Z" },
    { id: "empty", started_at: "2026-10-27T18:53:26Z", last_message_at: "2026-10-27T18:53:26Z" },
    { id: "live", started_at: "2026-10-27T18:53:31Z", last_message_at: "2026-10-28T12:54:00Z" },
  ];
  assert.equal(pickKeeper(threads).id, "live");
  // Same last message: more messages wins.
  const tie = threads.map((t) => ({ ...t, last_message_at: "2026-10-28T00:00:00Z" }));
  assert.equal(pickKeeper(tie, { old: 40, empty: 0, live: 12 }).id, "old");
});

test("only numbers with more than one thread are split", () => {
  const groups = splitNumbers([
    { id: "a", customer_phone: "+1" },
    { id: "b", customer_phone: "+2" },
    { id: "c", customer_phone: "+1" },
  ]);
  assert.deepEqual(groups.map(([phone, list]) => [phone, list.map((t) => t.id)]), [["+1", ["a", "c"]]]);
});

test("the kept thread keeps its own values and gains what the others had", () => {
  const keeper = {
    id: "k",
    customer_name: "قذلة حوف/ رانيا/الشرفه",
    started_at: "2026-10-27T18:53:31Z",
    last_message_at: "2026-10-28T12:54:00Z",
    last_inbound_at: "2026-10-28T12:06:00Z",
    unread_count: 1,
    metadata: { section: "orders", field_sessions: { o2: { driver: {} } } },
  };
  const retired = [{
    id: "r",
    customer_name: "رانيا ال زمانان..الشرفة",
    started_at: "2026-10-17T19:17:00Z",
    last_message_at: "2026-10-27T19:26:00Z",
    last_inbound_at: "2026-10-27T18:29:00Z",
    unread_count: 2,
    metadata: { section: "replies", wa_lid: "123@lid", field_sessions: { o1: { driver: { completed_at: "x" } } } },
  }];
  const patch = keeperPatch(keeper, retired);
  assert.equal(patch.started_at, "2026-10-17T19:17:00Z");
  assert.equal(patch.last_message_at, "2026-10-28T12:54:00Z");
  assert.equal(patch.last_inbound_at, "2026-10-28T12:06:00Z");
  assert.equal(patch.unread_count, 3);
  assert.equal(patch.customer_name, "قذلة حوف/ رانيا/الشرفه");
  assert.equal(patch.metadata.section, "orders");
  assert.equal(patch.metadata.wa_lid, "123@lid");
  assert.deepEqual(Object.keys(patch.metadata.field_sessions).sort(), ["o1", "o2"]);
  assert.deepEqual(patch.metadata.merged_from, ["r"]);
});

test("a name the team typed beats the WhatsApp name on the kept thread", () => {
  const keeper = { id: "k", customer_name: "اللهم صل على محمد", metadata: {} };
  const retired = [{ id: "r", customer_name: "روز/الفهد الشمالي", metadata: {} }];
  assert.equal(keeperPatch(keeper, retired, { renamedTo: "روز/الفهد الشمالي" }).customer_name, "روز/الفهد الشمالي");
  assert.equal(keeperPatch(keeper, retired).customer_name, "اللهم صل على محمد");
});

// A small in-memory stand-in for PostgREST: eq./in. filters, paging, counts,
// PATCH, upsert with ignore-duplicates, DELETE.
function fakeDb(tables, { failPatch } = {}) {
  const parse = (url) => {
    const u = new URL(url);
    const table = u.pathname.split("/").pop();
    const filters = [];
    for (const [key, value] of u.searchParams) {
      if (["select", "order", "offset", "limit", "on_conflict"].includes(key)) continue;
      const [op, ...rest] = value.split(".");
      const raw = rest.join(".");
      filters.push(op === "in"
        ? (row) => raw.slice(1, -1).split(",").includes(String(row[key]))
        : (row) => String(row[key]) === raw);
    }
    return { table, u, match: (row) => filters.every((f) => f(row)) };
  };
  const ok = (body, headers = {}) =>
    new Response(body === null ? "" : JSON.stringify(body), { status: 200, headers });
  return async (url, init = {}) => {
    const { table, u, match } = parse(url);
    const rows = (tables[table] ??= []);
    const method = init.method ?? "GET";
    if (method === "GET") {
      const hit = rows.filter(match);
      if (init.headers?.Prefer === "count=exact") return ok([], { "content-range": `0-0/${hit.length}` });
      const offset = Number(u.searchParams.get("offset") ?? 0);
      return ok(hit.slice(offset, offset + Number(u.searchParams.get("limit") ?? 1000)));
    }
    if (method === "PATCH") {
      if (failPatch?.(table)) return new Response("nope", { status: 400 });
      const body = JSON.parse(init.body);
      for (const row of rows) if (match(row)) Object.assign(row, body);
      return ok(null);
    }
    if (method === "POST") {
      const body = [].concat(JSON.parse(init.body));
      const keys = u.searchParams.get("on_conflict")?.split(",");
      for (const row of body) {
        if (keys && rows.some((r) => keys.every((k) => r[k] === row[k]))) continue;
        rows.push({ ...row });
      }
      return ok(null);
    }
    if (method === "DELETE") {
      tables[table] = rows.filter((row) => !match(row));
      return ok(null);
    }
    throw new Error(method);
  };
}

const seed = () => ({
  conversations: [
    { id: "old", restaurant_id: T, customer_phone: "+966500000001", customer_name: "رانيا", started_at: "2026-10-17T19:00:00Z", last_message_at: "2026-10-27T19:26:00Z", unread_count: 0, metadata: { wa_lid: "1@lid" } },
    { id: "empty", restaurant_id: T, customer_phone: "+966500000001", customer_name: "قذلة", started_at: "2026-10-27T18:53:26Z", last_message_at: "2026-10-27T18:53:26Z", unread_count: 0, metadata: {} },
    { id: "live", restaurant_id: T, customer_phone: "+966500000001", customer_name: "قذلة حوف", started_at: "2026-10-27T18:53:31Z", last_message_at: "2026-10-28T12:54:00Z", unread_count: 1, metadata: {} },
    { id: "alone", restaurant_id: T, customer_phone: "+966500000002", customer_name: "غيرها", started_at: "2026-10-01T00:00:00Z", last_message_at: "2026-10-02T00:00:00Z", unread_count: 0, metadata: {} },
  ],
  messages: [
    { id: "m1", conversation_id: "old" },
    { id: "m2", conversation_id: "old" },
    { id: "m3", conversation_id: "live" },
    { id: "m4", conversation_id: "alone" },
  ],
  driver_orders: [{ id: "d1", conversation_id: "old" }],
  conversation_label_assignments: [
    { conversation_id: "old", label_id: "L1" },
    { conversation_id: "old", label_id: "L2" },
    { conversation_id: "live", label_id: "L1" },
  ],
  operation_events: [{ id: "e1", restaurant_id: T, aggregate_type: "conversation", aggregate_id: "old", event_type: "x" }],
});
const quiet = { log: () => {}, warn: () => {} };

test("a dry run writes nothing", async () => {
  const tables = seed();
  const before = JSON.stringify(tables);
  await run({ url: "http://db", key: "k", apply: false, fetchImpl: fakeDb(tables), ...quiet });
  assert.equal(JSON.stringify(tables), before);
});

test("--apply folds every row into the kept thread, then deletes the emptied ones", async () => {
  const tables = seed();
  const dir = mkdtempSync(join(tmpdir(), "merge-"));
  await run({ url: "http://db", key: "k", apply: true, fetchImpl: fakeDb(tables), backupDir: dir, ...quiet });

  assert.deepEqual(tables.conversations.map((c) => c.id).sort(), ["alone", "live"]);
  assert.deepEqual(tables.messages.filter((m) => m.conversation_id === "live").map((m) => m.id).sort(), ["m1", "m2", "m3"]);
  assert.equal(tables.messages.find((m) => m.id === "m4").conversation_id, "alone");
  assert.equal(tables.driver_orders[0].conversation_id, "live");
  assert.deepEqual(tables.conversation_label_assignments.map((l) => `${l.conversation_id}:${l.label_id}`).sort(), ["live:L1", "live:L2"]);
  assert.equal(tables.operation_events.find((e) => e.id === "e1").aggregate_id, "live");
  const merged = tables.operation_events.find((e) => e.event_type === "conversation.merged");
  assert.deepEqual(merged.payload.retired.map((r) => r.id).sort(), ["empty", "old"]);
  const live = tables.conversations.find((c) => c.id === "live");
  assert.equal(live.started_at, "2026-10-17T19:00:00Z");
  assert.equal(live.metadata.wa_lid, "1@lid");

  const [file] = readdirSync(dir);
  const backup = JSON.parse(readFileSync(join(dir, file), "utf8"));
  assert.deepEqual(backup[0].retired.map((r) => r.id).sort(), ["empty", "old"]);

  // A second run has nothing left to do.
  const after = JSON.stringify(tables);
  await run({ url: "http://db", key: "k", apply: true, fetchImpl: fakeDb(tables), backupDir: dir, ...quiet });
  assert.equal(JSON.stringify(tables), after);
});

test("a thread that still has rows on it is never deleted", async () => {
  const tables = seed();
  // Moving notes fails, so the old thread keeps a row and must survive.
  tables.conversation_internal_notes = [{ id: "n1", conversation_id: "old" }];
  const fetchImpl = fakeDb(tables, { failPatch: (table) => table === "conversation_internal_notes" });
  await assert.rejects(
    run({ url: "http://db", key: "k", apply: true, fetchImpl, backupDir: mkdtempSync(join(tmpdir(), "merge-")), ...quiet }),
  );
  assert.ok(tables.conversations.some((c) => c.id === "old"));
});
