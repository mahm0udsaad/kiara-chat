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

/**
 * A tiny stand-in for the admin client: each table answers from a fixed list,
 * filtered by the eq/gte/is calls the module makes and ordered as asked.
 */
function fakeDb({ welcome, messages = [], reservations = [] }) {
  const tables = {
    restaurants: [{ id: "tenant", metadata: { campaigns: [], welcome } }],
    messages,
    rekaz_reservations: reservations,
  };
  const writes = [];
  const from = (table) => {
    let rows = [...tables[table]];
    const keys = [];
    const sorted = () =>
      [...rows].sort((a, b) => {
        for (const { col, ascending } of keys) {
          if (a[col] !== b[col]) return (a[col] < b[col] ? -1 : 1) * (ascending ? 1 : -1);
        }
        return 0;
      });
    const q = {
      select: () => q,
      eq: (col, v) => ((rows = rows.filter((r) => r[col] === undefined || r[col] === v)), q),
      gte: (col, v) => ((rows = rows.filter((r) => r[col] >= v)), q),
      is: (col, v) => ((rows = rows.filter((r) => (r[col] ?? null) === v)), q),
      order: (col, { ascending }) => (keys.push({ col, ascending }), q),
      limit: (n) => ((rows = sorted().slice(0, n)), q),
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      update: (patch) => {
        writes.push({ table, patch });
        return { eq: async () => ({ error: null }) };
      },
    };
    return q;
  };
  return { client: { from }, writes };
}

function welcomeModule(db) {
  const seen = { sent: [], saved: [], bumped: [] };
  const mod = load("src/lib/welcome-message.ts", {
    "@/lib/supabase/admin": { getAdminSupabaseClient: () => db.client },
    "@/lib/tenant": { KIARA_RESTAURANT_ID: "tenant" },
    "@/lib/transport": {
      isProviderConfigured: () => true,
      transportForConversation: async () => ({
        provider: "meta",
        sendText: async (to, body) => {
          seen.sent.push({ to, body });
          return { providerMessageId: "wamid.WELCOME" };
        },
      }),
    },
    "@/lib/server-conversations": {
      saveMessage: async (m) => seen.saved.push(m),
      bumpConversationActivity: async (...a) => seen.bumped.push(a),
    },
  });
  return { mod, seen };
}

const NOW = "2026-10-29T10:00:00.000Z";
const daysAgo = (n) => new Date(Date.parse(NOW) - n * 86_400_000).toISOString();
const input = { conversationId: "c1", customerPhone: "+966501234567", messageId: "m-new", receivedAt: NOW };
const mine = { id: "m-new", conversation_id: "c1", created_at: NOW };

test("a first-ever message gets the welcome, recorded in the thread", async () => {
  const db = fakeDb({ welcome: { enabled: true, text: "أهلًا" }, messages: [mine] });
  const { mod, seen } = welcomeModule(db);
  assert.equal(await mod.sendWelcomeIfDue(input), "sent");
  assert.deepEqual(seen.sent, [{ to: "+966501234567", body: "أهلًا" }]);
  assert.equal(seen.saved[0].metadata.source, "welcome");
  assert.equal(seen.saved[0].externalMessageSid, "wamid.WELCOME");
});

test("a customer back after more than 60 days of silence gets it again", async () => {
  const old = { id: "m-old", conversation_id: "c1", created_at: daysAgo(61) };
  const db = fakeDb({ welcome: { enabled: true, text: "أهلًا" }, messages: [old, mine] });
  const { mod } = welcomeModule(db);
  assert.equal(await mod.sendWelcomeIfDue(input), "sent");
});

test("a customer who wrote within 60 days does not", async () => {
  const recent = { id: "m-old", conversation_id: "c1", created_at: daysAgo(59) };
  const db = fakeDb({ welcome: { enabled: true, text: "أهلًا" }, messages: [recent, mine] });
  const { mod, seen } = welcomeModule(db);
  assert.equal(await mod.sendWelcomeIfDue(input), "not_first");
  assert.equal(seen.sent.length, 0);
});

test("of two messages in the same second, only the first gets the welcome", async () => {
  const twin = { id: "m-a", conversation_id: "c1", created_at: NOW };
  const db = fakeDb({ welcome: { enabled: true, text: "أهلًا" }, messages: [mine, twin] });
  const { mod } = welcomeModule(db);
  assert.equal(await mod.sendWelcomeIfDue({ ...input, messageId: "m-a" }), "sent");
  assert.equal(await mod.sendWelcomeIfDue(input), "not_first");
});

test("a recent or upcoming Rekaz booking skips it; an old or removed one does not", async () => {
  const booking = (arrival_at, removed_at = null) => ({
    restaurant_id: "tenant", customer_phone: "+966501234567", source_id: "r1", arrival_at, removed_at,
  });
  const run = async (reservations) => {
    const db = fakeDb({ welcome: { enabled: true, text: "أهلًا" }, messages: [mine], reservations });
    return welcomeModule(db).mod.sendWelcomeIfDue(input);
  };
  assert.equal(await run([booking(daysAgo(-3))]), "has_booking");
  assert.equal(await run([booking(daysAgo(20))]), "has_booking");
  assert.equal(await run([booking(daysAgo(90))]), "sent");
  assert.equal(await run([booking(daysAgo(-3), daysAgo(1))]), "sent");
});

test("switched off, or never saved, nothing is sent", async () => {
  for (const welcome of [undefined, { enabled: false, text: "أهلًا" }]) {
    const db = fakeDb({ welcome, messages: [mine] });
    const { mod, seen } = welcomeModule(db);
    assert.equal(await mod.sendWelcomeIfDue(input), "off");
    assert.equal(seen.sent.length, 0);
  }
});

test("saving keeps the rest of the restaurant metadata", async () => {
  const db = fakeDb({ welcome: undefined });
  const { mod } = welcomeModule(db);
  assert.equal((await mod.getWelcomeSettings()).text, mod.DEFAULT_WELCOME_TEXT);
  await mod.saveWelcomeSettings({ enabled: true, text: "  مرحبا  " });
  assert.deepEqual(db.writes[0].patch.metadata, { campaigns: [], welcome: { enabled: true, text: "مرحبا" } });
});
