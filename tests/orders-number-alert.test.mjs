import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import ts from "typescript";

// Execute the actual server module with its database, push and engine stubbed.
function load(path, imports = {}) {
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  const require = (name) => {
    assert.ok(name in imports, `Unexpected dependency: ${name}`);
    return imports[name];
  };
  new Function("require", "module", "exports", code)(require, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

class EngineUnavailableError extends Error {
  constructor(message, options) {
    super(message);
    this.reason = options?.reason ?? "unreachable";
  }
}

/** Just enough of operation_events, including its unique idempotency index. */
function fakeEvents() {
  const rows = [];
  let clock = 0;
  const client = {
    from() {
      const state = { filters: {}, mode: "select" };
      const builder = {
        select() { return builder; },
        eq(column, value) { state.filters[column] = value; return builder; },
        order() { return builder; },
        limit() { return builder; },
        async maybeSingle() {
          const match = rows
            .filter((row) => row.aggregate_type === state.filters.aggregate_type)
            .sort((a, b) => b.seq - a.seq)[0];
          return { data: match ?? null, error: null };
        },
        insert(row) {
          state.insert = row;
          return builder;
        },
        async single() {
          const row = state.insert;
          if (rows.some((r) => r.idempotency_key === row.idempotency_key && r.event_type === row.event_type)) {
            return { data: null, error: { code: "23505", message: "duplicate" } };
          }
          clock += 1;
          const stored = {
            ...row,
            id: `evt-${clock}`,
            seq: clock,
            occurred_at: new Date(Date.now() + clock).toISOString(),
          };
          rows.push(stored);
          return { data: { id: stored.id }, error: null };
        },
        delete() { state.mode = "delete"; return builder; },
        then(resolve) {
          if (state.mode === "delete") {
            const index = rows.findIndex((r) => r.id === state.filters.id);
            if (index >= 0) rows.splice(index, 1);
          }
          resolve({ error: null });
        },
      };
      return builder;
    },
  };
  return { rows, client };
}

function setup({ pushFails = false } = {}) {
  const db = fakeEvents();
  const pushes = [];
  let engine = async () => ({ providerMessageId: "wa-1" });
  let engineState = "ready";
  const mod = load("src/lib/orders-number.ts", {
    "server-only": {},
    crypto,
    "@/lib/inbox-notifications": {
      notifyOrdersNumberWatchers: async (message) => {
        if (pushFails) throw new Error("expo down");
        pushes.push(message);
      },
    },
    "@/lib/supabase/admin": { getAdminSupabaseClient: () => db.client },
    "@/lib/tenant": { KIARA_RESTAURANT_ID: "tenant-1" },
    "@/lib/transport/openwa": {
      EngineUnavailableError,
      isOpenWaConfigured: () => true,
      getEngineState: async () => ({ state: engineState }),
      openWaTransport: {
        sendText: (...args) => engine(...args),
        sendMedia: (...args) => engine(...args),
      },
    },
  });
  return {
    mod,
    db,
    pushes,
    setEngine: (fn) => { engine = fn; },
    setEngineState: (state) => { engineState = state; },
  };
}

const disconnected = async () => {
  throw new EngineUnavailableError("OpenWA send failed (503): not connected", { reason: "disconnected" });
};

test("one dispatch failing three sends at once alerts the watchers once", async () => {
  const { mod, pushes, setEngine } = setup();
  setEngine(disconnected);
  const results = await Promise.allSettled([
    mod.ordersNumber.sendText("+966500000001", "driver"),
    mod.ordersNumber.sendText("+966500000002", "specialist"),
    mod.ordersNumber.sendText("+966500000003", "second specialist"),
  ]);
  assert.ok(results.every((r) => r.status === "rejected"), "the send error still reaches the caller");
  assert.equal(pushes.length, 1);
  assert.match(pushes[0].title, /انفصل عن واتساب/);
  assert.match(pushes[0].body, /امسحي رمز QR/);
});

test("later failures inside the reminder window stay quiet, recovery is announced once", async () => {
  const { mod, pushes, setEngine } = setup();
  setEngine(disconnected);
  await mod.ordersNumber.sendText("+966500000001", "a").catch(() => {});
  await mod.ordersNumber.sendText("+966500000001", "b").catch(() => {});
  assert.equal(pushes.length, 1);

  setEngine(async () => ({ providerMessageId: "wa-2" }));
  assert.equal((await mod.ordersNumber.sendText("+966500000001", "c")).providerMessageId, "wa-2");
  await mod.ordersNumber.sendText("+966500000001", "d");
  assert.equal(pushes.length, 2);
  assert.match(pushes[1].title, /عاد للعمل/);

  // A new outage after recovery is a new alert.
  setEngine(disconnected);
  await mod.ordersNumber.sendText("+966500000001", "e").catch(() => {});
  assert.equal(pushes.length, 3);
});

test("an unreachable server is not sent to the QR page", async () => {
  const { mod, pushes, setEngine } = setup();
  setEngine(async () => {
    throw new EngineUnavailableError("OpenWA engine unreachable", { reason: "unreachable" });
  });
  await mod.ordersNumber.sendText("+966500000001", "a").catch(() => {});
  assert.match(pushes[0].title, /لا يستجيب/);
  assert.doesNotMatch(pushes[0].body, /امسحي/);
});

test("an ordinary refused send raises no alarm", async () => {
  const { mod, pushes, setEngine } = setup();
  setEngine(async () => { throw new Error("OpenWA send failed (400): bad number"); });
  await assert.rejects(mod.ordersNumber.sendText("+1", "a"), /bad number/);
  assert.equal(pushes.length, 0);
});

test("a push that never left is un-recorded so the next failure retries it", async () => {
  const { mod, db, setEngine } = setup({ pushFails: true });
  setEngine(disconnected);
  await mod.ordersNumber.sendText("+966500000001", "a").catch(() => {});
  assert.equal(db.rows.length, 0);
});

test("Arabic durations read naturally", () => {
  const { mod } = setup();
  assert.equal(mod.arabicDuration(60 * 60_000), "ساعة");
  assert.equal(mod.arabicDuration(2 * 60 * 60_000), "ساعتين");
  assert.equal(mod.arabicDuration(5 * 60 * 60_000), "5 ساعات");
  assert.equal(mod.arabicDuration(17 * 24 * 60 * 60_000), "17 يومًا");
});

test("the 30-minute check alerts on a dropped session and shares the once-per-outage record", async () => {
  const { mod, pushes, setEngine, setEngineState } = setup();
  setEngineState("awaiting_qr");
  assert.equal((await mod.checkOrdersNumber()).state, "awaiting_qr");
  assert.equal(pushes.length, 1);
  assert.match(pushes[0].title, /انفصل عن واتساب/);

  // A dispatch failing right after the check is the same outage.
  setEngine(disconnected);
  await mod.ordersNumber.sendText("+966500000001", "a").catch(() => {});
  assert.equal(pushes.length, 1);

  setEngineState("ready");
  await mod.checkOrdersNumber();
  assert.equal(pushes.length, 2);
  assert.match(pushes[1].title, /عاد للعمل/);
});

test("the check stays quiet while the engine is settling after a restart", async () => {
  const { mod, pushes, setEngineState } = setup();
  for (const state of ["initializing", "authenticated", "ready"]) {
    setEngineState(state);
    await mod.checkOrdersNumber();
  }
  assert.equal(pushes.length, 0);
});

test("an unreachable engine on the check is reported as a server problem", async () => {
  const { mod, pushes, setEngineState } = setup();
  setEngineState("unreachable");
  await mod.checkOrdersNumber();
  assert.match(pushes[0].title, /لا يستجيب/);
});
