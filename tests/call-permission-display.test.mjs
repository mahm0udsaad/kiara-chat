import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Loads the real module with the database, Meta and Next stubbed out.
function load({ row, graph }) {
  const code = ts.transpileModule(
    readFileSync(new URL("../src/lib/call-permissions.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const calls = { graph: 0, background: [] };
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: row, error: null }),
    upsert: () => query,
    // The save returns the written row, even for a customer seen the first time.
    single: async () => ({ data: row ?? { id: "p1", customer_phone: "+966500000000", status: "granted", is_permanent: true, expires_at: null, response_source: null, requested_at: null, request_message_sid: null, responded_at: null, last_synced_at: new Date().toISOString() }, error: null }),
  };
  const imports = {
    "server-only": {},
    "next/server": { after: (fn) => calls.background.push(fn) },
    "@/lib/tenant": { KIARA_RESTAURANT_ID: "r" },
    "@/lib/phone": { canonicalPhone: (p) => p },
    "@/lib/audit": { CONVERSATION_EVENTS: {}, recordSystemConversationEvent: async () => {} },
    "@/lib/supabase/admin": { getAdminSupabaseClient: () => ({ from: () => query }) },
    "@/lib/transport/meta-calling": {
      fetchCallPermission: async () => {
        calls.graph += 1;
        return graph;
      },
    },
  };
  const mod = { exports: {} };
  const require = (name) => {
    assert.ok(name in imports, `Unexpected dependency: ${name}`);
    return imports[name];
  };
  new Function("require", "module", "exports", code)(require, mod, mod.exports);
  return { ...mod.exports, calls };
}

const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();
const row = (syncedMinutesAgo, status = "granted") => ({
  id: "p1", customer_phone: "+966500000000", status, is_permanent: true, expires_at: null,
  response_source: null, requested_at: null, request_message_sid: null, responded_at: null,
  last_synced_at: minutesAgo(syncedMinutesAgo),
});
const graph = { status: "permanent", canCall: true, canRequest: false, recognised: true, raw: {} };

test("showing the pill uses a 5-minute-old answer without asking Meta", async () => {
  const m = load({ row: row(5), graph });
  const r = await m.resolveCallPermission("+966500000000", { forDisplay: true });
  assert.equal(r.status, "granted");
  assert.equal(m.calls.graph, 0);
  assert.equal(m.calls.background.length, 0);
});

test("an older saved answer is shown at once and refreshed in the background", async () => {
  const m = load({ row: row(30), graph });
  const r = await m.resolveCallPermission("+966500000000", { forDisplay: true });
  assert.equal(r.status, "granted");
  assert.equal(m.calls.graph, 0, "the response did not wait on Meta");
  assert.equal(m.calls.background.length, 1);
  await m.calls.background[0]();
  assert.equal(m.calls.graph, 1, "Meta was asked after the response");
});

test("placing a call still asks Meta when the answer is over a minute old", async () => {
  const m = load({ row: row(5), graph });
  await m.resolveCallPermission("+966500000000");
  assert.equal(m.calls.graph, 1);
});

test("a customer never synced is looked up before showing anything", async () => {
  const m = load({ row: null, graph });
  await m.resolveCallPermission("+966500000000", { forDisplay: true });
  assert.equal(m.calls.graph, 1);
});
