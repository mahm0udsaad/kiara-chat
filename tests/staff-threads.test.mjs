import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

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

const phone = load("src/lib/phone.ts");

/** drivers, specialists and conversations, as the service-role client sees them. */
function fakeAdmin(tables) {
  return {
    from(table) {
      const filters = {};
      const builder = {
        select() { return builder; },
        eq(column, value) { filters[column] = value; return builder; },
        async maybeSingle() {
          const row = (tables[table] ?? []).find((r) => r.id === filters.id) ?? null;
          return { data: row, error: null };
        },
        then(resolve) { resolve({ data: tables[table] ?? [], error: null }); },
      };
      return builder;
    },
  };
}

function setup({ labeled = [] } = {}) {
  const meta = { provider: "meta" };
  const ordersNumberTransport = { provider: "openwa" };
  const mod = load("src/lib/staff-threads.ts", {
    "server-only": {},
    "@/lib/orders-number": { ordersNumberTransport },
    "@/lib/phone": phone,
    "@/lib/specialist-conversations": {
      listSpecialistLabeledConversationIds: async (ids) => new Set(ids.filter((id) => labeled.includes(id))),
    },
    "@/lib/supabase/admin": {
      getAdminSupabaseClient: () => fakeAdmin({
        drivers: [{ phone: "+966503319364" }],
        specialists: [{ phone: "+639171234817" }],
        conversations: [
          { id: "driver-thread", customer_phone: "+966503319364" },
          { id: "specialist-thread", customer_phone: "+639171234817" },
          { id: "customer-thread", customer_phone: "+966538948831" },
          { id: "labeled-thread", customer_phone: "+966511111111" },
          { id: "group-thread", customer_phone: "120363000000000000@g.us" },
        ],
      }),
    },
    "@/lib/tenant": { KIARA_RESTAURANT_ID: "tenant-1" },
    "@/lib/transport": { transportForConversation: async () => meta },
  });
  return mod;
}

test("driver and specialist threads reply from the orders number; customers stay on Meta", async () => {
  const mod = setup({ labeled: ["labeled-thread"] });
  assert.equal((await mod.inboxTransportFor("driver-thread")).provider, "openwa");
  assert.equal((await mod.inboxTransportFor("specialist-thread")).provider, "openwa");
  assert.equal((await mod.inboxTransportFor("labeled-thread")).provider, "openwa");
  assert.equal((await mod.inboxTransportFor("customer-thread")).provider, "meta");
  assert.equal((await mod.inboxTransportFor("group-thread")).provider, "meta");
});

test("roster phones match however the number is written", async () => {
  const mod = setup();
  assert.equal(await mod.staffKindForPhone("+966 50 331 9364"), "driver");
  assert.equal(await mod.staffKindForPhone("0503319364"), "driver");
  assert.equal(await mod.staffKindForPhone("+639171234817"), "specialist");
  assert.equal(await mod.staffKindForPhone("+966538948831"), null);
  assert.equal(await mod.staffKindForPhone("120363000000000000@g.us"), null);
  assert.equal(await mod.staffKindForPhone(null), null);
});
