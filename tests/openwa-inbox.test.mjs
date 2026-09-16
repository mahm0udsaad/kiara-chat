import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Execute the actual server modules with isolated engine/database dependencies.
function load(path, imports = {}, env = {}, fetch = globalThis.fetch) {
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  const require = (name) => {
    assert.ok(name in imports, `Unexpected dependency: ${name}`);
    return imports[name];
  };
  new Function("require", "module", "exports", "process", "fetch", code)(
    require, loadedModule, loadedModule.exports, { env }, fetch,
  );
  return loadedModule.exports;
}

const configPath = "src/lib/transport/inbox-provider.ts";
const events = load("src/lib/transport/openwa-events.ts");

test("inbox defaults to Twilio while OpenWA remains an explicit independent option", async () => {
  const env = {};
  const config = load(configPath, {}, env);
  const adapters = Object.fromEntries(["openwa", "twilio", "meta"].map((provider) => [
    `./${provider}`, provider === "openwa"
      ? { openWaTransport: { provider }, isOpenWaConfigured: () => true }
      : provider === "twilio"
        ? { twilioTransport: { provider }, isTwilioConfigured: () => false }
        : { metaTransport: { provider }, isMetaCloudConfigured: () => true },
  ]));
  const routing = load("src/lib/transport/index.ts", { ...adapters, "./inbox-provider": config }, env);
  assert.equal(routing.customerProvider(), "twilio");
  assert.equal(routing.defaultOutboundProvider(), "twilio");
  assert.equal((await routing.transportForConversation("old-twilio-thread")).provider, "twilio");
  assert.equal(routing.isAnyTransportConfigured(), false);
  env.WHATSAPP_INBOX_PROVIDER = " OPENWA ";
  assert.equal((await routing.transportForConversation("customer")).provider, "openwa");
  assert.equal(routing.isAnyTransportConfigured(), true);
  env.WHATSAPP_INBOX_PROVIDER = "twilio";
  env.WHATSAPP_CUSTOMER_PROVIDER = "meta";
  assert.equal(routing.customerProvider(), "meta");
  assert.equal(routing.defaultOutboundProvider(), "twilio");
  env.WHATSAPP_INBOX_PROVIDER = "typo";
  assert.throws(() => routing.defaultOutboundProvider(), /WHATSAPP_INBOX_PROVIDER/);
});

test("OpenWA sends text and media using only the engine bearer token", async () => {
  const requests = [];
  const { openWaTransport } = load("src/lib/transport/openwa.ts", {}, {
    OPENWA_URL: "https://engine.example/", OPENWA_SEND_TOKEN: "engine-test-token",
  }, async (url, init) => {
    requests.push({ url, ...init, body: JSON.parse(init.body) });
    return Response.json({ waMessageId: "wa-123" });
  });
  assert.equal((await openWaTransport.sendText("+966500000000", "Hello")).providerMessageId, "wa-123");
  await openWaTransport.sendMedia("+966500000000", { base64: "YQ==", contentType: "audio/ogg", ptt: true });
  assert.equal(requests[0].url, "https://engine.example/messages");
  assert.equal(requests[0].headers.Authorization, "Bearer engine-test-token");
  assert.equal(requests[0].body.body, "Hello");
  assert.equal(requests[1].body.media.ptt, true);
  assert.equal(requests[1].body.media.base64, "YQ==");
});

function webhook({ provider = "openwa", duplicate = false, concurrentDuplicate = false } = {}) {
  const calls = { messages: [], activity: [], handled: [], jobs: [], transport: [], acks: [] };
  const db = {
    hasMessageWithSid: async () => duplicate,
    findOrCreateConversation: async () => ({ id: "customer" }),
    findOrCreateGroupConversation: async () => ({ id: "group" }),
    findConversationByLid: async () => ({ id: "customer" }),
    findConversationByPhone: async () => ({ id: "customer" }),
    rememberChatLid: async () => {},
    saveMessage: async (message) => { calls.messages.push(message); return concurrentDuplicate ? null : "message"; },
    bumpConversationActivity: async (...args) => calls.activity.push(args),
    markHandledOnWhatsApp: async (id) => calls.handled.push(id),
    rememberConversationTransport: async (...args) => calls.transport.push(args),
    updateDeliveryStatus: async (...args) => calls.acks.push(args),
  };
  const { POST } = load("src/app/api/webhooks/openwa/route.ts", {
    "@/lib/transport/openwa-events": events,
    "@/lib/transport/inbox-provider": { inboxProvider: () => provider },
    "next/server": { NextResponse: Response, after: (job) => calls.jobs.push(job) },
    "@/lib/tenant": { KIARA_RESTAURANT_ID: "tenant" },
    "@/lib/bot/reply": { runBotTurn: async () => {} },
    "@/lib/presence": { broadcastTyping: async () => {} },
    "@/lib/inbox-notifications": { notifyInboundInboxMessage: async () => {} },
    "@/lib/server-conversations": db,
    "@/lib/storage-media": {
      uploadBase64Media: async () => ({ path: "stored" }),
      messageTypeFromContentType: () => "image",
    },
  }, { OPENWA_INGEST_TOKEN: "ingest-test-token" });
  const send = (event, token = "ingest-test-token") => POST(new Request("https://app.example/api/webhooks/openwa", {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(event),
  }));
  return { send, calls };
}
const inbound = { type: "message", waMessageId: "wa-inbound", fromMe: false, customerPhone: "+966500000000", body: "Hello" };

test("unauthenticated and malformed engine events never write data", async () => {
  const { send, calls } = webhook();
  assert.equal((await send(inbound, "wrong-token")).status, 401);
  for (const event of [null, [], {}, { ...inbound, fromMe: "false" }, { ...inbound, timestamp: 1e100 }, { ...inbound, media: [{}] }]) {
    assert.equal((await send(event)).status, 400);
  }
  assert.equal(calls.messages.length, 0);
});

test("live inbound populates the conversation and schedules notification and bot", async () => {
  const { send, calls } = webhook();
  assert.equal((await send(inbound)).status, 200);
  assert.equal(calls.messages[0].role, "customer");
  assert.equal(calls.messages[0].metadata.provider, "openwa");
  assert.deepEqual(calls.transport, [["customer", "openwa"]]);
  assert.equal(calls.activity[0][1].incrementUnread, true);
  assert.equal(calls.jobs.length, 2);
});

test("history replay preserves time and does not wake bot, notify, or increase unread", async () => {
  const { send, calls } = webhook();
  const timestamp = Math.floor(Date.now() / 1000) - 86400;
  await send({ ...inbound, timestamp });
  assert.equal(calls.messages[0].createdAt, new Date(timestamp * 1000).toISOString());
  assert.equal(calls.activity[0][1].occurredAt, calls.messages[0].createdAt);
  assert.equal(calls.activity[0][1].incrementUnread, false);
  assert.equal(calls.jobs.length, 0);
});

test("phone replies and group media retain their inbox semantics", async () => {
  const phone = webhook();
  await phone.send({ ...inbound, fromMe: true });
  assert.equal(phone.calls.messages[0].role, "agent");
  assert.equal(phone.calls.messages[0].metadata.source, "whatsapp_app");
  assert.deepEqual(phone.calls.handled, ["customer"]);
  assert.equal(phone.calls.jobs.length, 0);
  const group = webhook();
  await group.send({ ...inbound, chatJid: "123@g.us", participantName: "Staff", media: [{ base64: "YQ==", contentType: "image/jpeg" }] });
  assert.equal(group.calls.messages[0].conversationId, "group");
  assert.equal(group.calls.messages[0].messageType, "image");
  assert.equal(group.calls.messages[0].metadata.participant_name, "Staff");
  assert.equal(group.calls.jobs.length, 0);
});

test("both retry and concurrent duplicate suppress downstream activity", async () => {
  for (const options of [{ duplicate: true }, { concurrentDuplicate: true }]) {
    const { send, calls } = webhook(options);
    assert.equal((await (await send(inbound)).json()).deduped, true);
    assert.equal(calls.activity.length, 0);
    assert.equal(calls.jobs.length, 0);
  }
});

test("rollback stops OpenWA ingestion while accepting outstanding delivery acks", async () => {
  const { send, calls } = webhook({ provider: "twilio" });
  assert.equal((await (await send(inbound)).json()).standby, true);
  assert.equal(calls.messages.length, 0);
  await send({ type: "ack", waMessageId: "wa-old", status: "read" });
  assert.deepEqual(calls.acks, [["wa-old", "read"]]);
});

test("replayed activity cannot move an existing chat backwards or inflate unread", async () => {
  const updates = [];
  const row = { last_message_at: "2026-09-13T10:00:00+00:00", last_inbound_at: "2026-09-13T09:00:00+00:00", unread_count: 3 };
  const query = {
    select: () => query, eq: () => query,
    maybeSingle: async () => ({ data: row, error: null }),
    update: (patch) => { updates.push(patch); return query; },
    then: (resolve) => Promise.resolve({ error: null }).then(resolve),
  };
  const { bumpConversationActivity } = load("src/lib/server-conversations.ts", {
    "@/lib/supabase/admin": { getAdminSupabaseClient: () => ({ from: () => query }) },
    "@/lib/tenant": { KIARA_RESTAURANT_ID: "tenant" },
    "@/lib/phone": {},
  });
  await bumpConversationActivity("customer", { inbound: true, occurredAt: "2026-09-12T10:00:00.000Z", incrementUnread: false });
  assert.equal(updates.length, 0);
  await bumpConversationActivity("customer", { inbound: true, occurredAt: "2026-09-13T10:01:00.000Z" });
  assert.deepEqual(updates[0], { last_message_at: "2026-09-13T10:01:00.000Z", last_inbound_at: "2026-09-13T10:01:00.000Z", unread_count: 4 });
});

test("new chats imported from history start at the original time", async () => {
  const inserts = [];
  const query = {
    select: () => query, eq: () => query, order: () => query, limit: () => query,
    maybeSingle: async () => ({ data: null, error: null }),
    insert: (row) => { inserts.push(row); return query; },
    single: async () => ({ data: { id: "new" }, error: null }),
  };
  const server = load("src/lib/server-conversations.ts", {
    "@/lib/supabase/admin": { getAdminSupabaseClient: () => ({ from: () => query }) },
    "@/lib/tenant": { KIARA_RESTAURANT_ID: "tenant" },
    "@/lib/phone": { canonicalPhone: (phone) => phone },
  });
  const timestamp = "2026-09-01T10:00:00.000Z";
  await server.findOrCreateConversation("+966500000000", "Customer", timestamp);
  await server.findOrCreateGroupConversation("123@g.us", "Group", timestamp);
  assert.equal(inserts.length, 2);
  for (const row of inserts) {
    assert.equal(row.started_at, timestamp);
    assert.equal(row.last_message_at, timestamp);
    assert.equal(row.restaurant_id, "tenant");
  }
});
