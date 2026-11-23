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

/** A chainable stand-in for the service-role query builder. */
function chain(result) {
  const builder = new Proxy({}, {
    get: (_, key) => (key === "then" ? (resolve) => resolve(result()) : () => builder),
  });
  return builder;
}

function webhook({
  provider = "openwa",
  duplicate = false,
  concurrentDuplicate = false,
  staffPhones = [],
  pendingAppSends = [],
  isNew = false,
} = {}) {
  const calls = { messages: [], activity: [], handled: [], jobs: [], transport: [], acks: [], claimed: [], lids: [] };
  const db = {
    hasMessageWithSid: async () => duplicate,
    findOrCreateConversation: async () => ({ id: "customer", is_new: isNew }),
    findOrCreateGroupConversation: async () => ({ id: "group" }),
    findConversationByLid: async () => ({ id: "customer" }),
    findConversationByPhone: async () => ({ id: "customer" }),
    rememberChatLid: async (...args) => calls.lids.push(args),
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
    // The second customer-facing engine is recognised only by its own token.
    "@/lib/whatsapp-senders": {
      senderForIngestToken: (header) => (header === "Bearer cs-test-token" ? "openwa_cs" : null),
    },
    "@/lib/staff-threads": {
      staffKindForPhone: async (phone) => (staffPhones.includes(phone) ? "driver" : null),
      staffKindForConversation: async () => null,
    },
    "@/lib/supabase/admin": {
      getAdminSupabaseClient: () => ({
        from: () => ({
          select: () => chain(() => ({ data: pendingAppSends })),
          update: (patch) => {
            calls.claimed.push(patch);
            return chain(() => ({ data: pendingAppSends.slice(0, 1) }));
          },
        }),
      }),
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

test("with customers on Meta, the orders number still takes in the field team", async () => {
  const driver = "+966503319364";
  const { send, calls } = webhook({ provider: "meta", staffPhones: [driver] });
  assert.equal((await (await send({ ...inbound, customerPhone: driver })).json()).ok, true);
  assert.equal(calls.messages[0].role, "customer");
  // Notified, but never answered by the bot.
  assert.equal(calls.jobs.length, 1);

  // A customer writing to the orders number is still ignored.
  assert.equal((await (await send({ ...inbound, waMessageId: "wa-2" })).json()).standby, true);
  assert.equal(calls.messages.length, 1);
});

test("order notifications echoing back do not flag a field-team chat as handled on the phone", async () => {
  const driver = "+966503319364";
  const { send, calls } = webhook({ provider: "meta", staffPhones: [driver] });
  await send({ ...inbound, fromMe: true, customerPhone: driver, body: "🚗 طلب جديد" });
  assert.equal(calls.messages[0].role, "agent");
  assert.deepEqual(calls.handled, []);
});

test("the echo of an app reply claims the pending row instead of storing it twice", async () => {
  const { send, calls } = webhook({ pendingAppSends: [{ id: "queued-reply", content: "Hello" }] });
  assert.equal((await (await send({ ...inbound, fromMe: true })).json()).deduped, true);
  assert.equal(calls.messages.length, 0);
  assert.deepEqual(calls.claimed, [{ external_message_sid: "wa-inbound" }]);
});

test("the echo of an app send still teaches the chat's lid, even though it is a duplicate", async () => {
  const { send, calls } = webhook({ provider: "meta", duplicate: true });
  await send({ ...inbound, fromMe: true, chatLid: "123@lid" });
  assert.deepEqual(calls.lids, [["customer", "123@lid"]]);
});

test("a lid-only message no thread knows is reported, not silently swallowed", async () => {
  const { send, calls } = webhook({ provider: "meta" });
  const warnings = [];
  const warn = console.warn;
  console.warn = (line) => warnings.push(line);
  try {
    const body = await (await send({ ...inbound, customerPhone: null, chatLid: "999@lid", customerName: "عبدالفتاح" })).json();
    assert.equal(body.standby, true);
  } finally {
    console.warn = warn;
  }
  assert.equal(calls.messages.length, 0);
  assert.match(warnings[0], /unbound lid.*999@lid.*عبدالفتاح/);
});

test("a reaction and a shared location arrive readable, and the bot leaves them alone", async () => {
  const { send, calls } = webhook();
  await send({ ...inbound, waMessageId: "wa-r", messageType: "reaction", body: "تفاعل بـ 👍", reactionTo: "wa-unknown" });
  assert.equal(calls.messages[0].messageType, "reaction");
  assert.equal(calls.messages[0].content, "تفاعل بـ 👍 على رسالة");
  assert.equal(calls.messages[0].metadata.reaction_to, "wa-unknown");
  const location = { latitude: 17.49, longitude: 44.13, name: "حي الضباط" };
  await send({ ...inbound, waMessageId: "wa-l", messageType: "location", body: "📍 الموقع: حي الضباط", location });
  assert.deepEqual(calls.messages[1].metadata.location, location);
  // One notification job each, and no bot turn for either.
  assert.equal(calls.jobs.length, 2);
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
    "@/lib/delivery-status": { statusesReplaceableBy: () => null },
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
  // Before the find_or_create_conversation migration: the old insert path.
  const missingFunction = async () => ({
    data: null,
    error: { message: "Could not find the function public.find_or_create_conversation" },
  });
  const server = load("src/lib/server-conversations.ts", {
    "@/lib/supabase/admin": { getAdminSupabaseClient: () => ({ from: () => query, rpc: missingFunction }) },
    "@/lib/tenant": { KIARA_RESTAURANT_ID: "tenant" },
    "@/lib/delivery-status": { statusesReplaceableBy: () => null },
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

test("new threads are created through the per-number lock, original time kept", async () => {
  const rpcCalls = [];
  const query = {
    select: () => query, eq: () => query, order: () => query, limit: () => query, is: () => query,
    update: () => query,
    maybeSingle: async () => ({ data: null, error: null }),
    insert: () => { throw new Error("must not insert directly when the locked function exists"); },
  };
  const server = load("src/lib/server-conversations.ts", {
    "@/lib/supabase/admin": {
      getAdminSupabaseClient: () => ({
        from: () => query,
        rpc: async (name, args) => {
          rpcCalls.push({ name, args });
          return { data: [{ id: "locked", is_new: true }], error: null };
        },
      }),
    },
    "@/lib/tenant": { KIARA_RESTAURANT_ID: "tenant" },
    "@/lib/delivery-status": { statusesReplaceableBy: () => null },
    "@/lib/phone": { canonicalPhone: (phone) => phone },
  });
  const timestamp = "2026-09-01T10:00:00.000Z";
  assert.deepEqual(await server.findOrCreateConversation("+966500000000", "Customer", timestamp), { id: "locked", is_new: true });
  assert.deepEqual(await server.findOrCreateGroupConversation("123@g.us", "Group", timestamp), { id: "locked", is_new: true });
  assert.equal(rpcCalls.length, 2);
  assert.equal(rpcCalls[0].name, "find_or_create_conversation");
  assert.equal(rpcCalls[0].args.p_customer_phone, "+966500000000");
  assert.equal(rpcCalls[0].args.p_started_at, timestamp);
  assert.deepEqual(rpcCalls[1].args.p_metadata, { chat_kind: "group" });
});

test("a failed thread lookup stops instead of opening another thread", async () => {
  const query = {
    select: () => query, eq: () => query, order: () => query, limit: () => query,
    maybeSingle: async () => ({ data: null, error: { message: "canceling statement due to statement timeout" } }),
    insert: () => { throw new Error("must not insert after a failed lookup"); },
  };
  const server = load("src/lib/server-conversations.ts", {
    "@/lib/supabase/admin": {
      getAdminSupabaseClient: () => ({
        from: () => query,
        rpc: async () => ({ data: null, error: { message: "canceling statement due to statement timeout" } }),
      }),
    },
    "@/lib/tenant": { KIARA_RESTAURANT_ID: "tenant" },
    "@/lib/delivery-status": { statusesReplaceableBy: () => null },
    "@/lib/phone": { canonicalPhone: (phone) => phone },
  });
  await assert.rejects(() => server.findOrCreateConversation("+966500000000", "Customer"), /lookup failed/);
});

test("the second number takes in its customers, tagged with that number, without the bot", async () => {
  // Customers are on Meta, so the orders number would stand this message by.
  const { send, calls } = webhook({ provider: "meta", isNew: true });
  const response = await send(inbound, "cs-test-token");
  assert.equal(response.status, 200);
  assert.equal(calls.messages.length, 1);
  assert.equal(calls.messages[0].senderAccount, "openwa_cs");
  assert.equal(calls.messages[0].metadata.sender_account, "openwa_cs");
  // A brand-new customer is answered from the number she wrote to.
  assert.deepEqual(calls.claimed.at(-1), { reply_sender: "openwa_cs" });
  // Notification only; the bot answers on the Business number, never here.
  assert.equal(calls.jobs.length, 1);
});

test("an existing customer writing to the second number keeps her saved reply number", async () => {
  const { send, calls } = webhook({ provider: "meta", isNew: false });
  await send(inbound, "cs-test-token");
  assert.equal(calls.messages[0].senderAccount, "openwa_cs");
  assert.equal(calls.claimed.some((patch) => "reply_sender" in patch), false);
});

test("groups stay off on the second number, and the orders number keeps its field-team rule", async () => {
  const cs = webhook({ provider: "meta" });
  const group = { ...inbound, chatJid: "120363000000000000@g.us" };
  assert.deepEqual(await (await cs.send(group, "cs-test-token")).json(), { ok: true, standby: true });
  assert.equal(cs.calls.messages.length, 0);

  const orders = webhook({ provider: "meta" });
  assert.deepEqual(await (await orders.send(inbound)).json(), { ok: true, standby: true });
  const driver = webhook({ provider: "meta", staffPhones: ["+966500000000"] });
  await driver.send(inbound);
  assert.equal(driver.calls.messages[0].senderAccount, "openwa");
});

test("a second engine sends with its own address and token, never the orders engine's", async () => {
  const requests = [];
  const { createOpenWaTransport, openWaTransport } = load("src/lib/transport/openwa.ts", {}, {
    OPENWA_URL: "https://orders.example/", OPENWA_SEND_TOKEN: "orders-token",
  }, async (url, init) => {
    requests.push({ url, auth: init.headers.Authorization });
    return Response.json({ waMessageId: "wa-cs" });
  });
  const cs = createOpenWaTransport({ url: "https://cs.example", token: "cs-token" });
  await cs.sendText("+966500000000", "مرحبا");
  await openWaTransport.sendText("+966500000000", "order note");
  assert.deepEqual(requests, [
    { url: "https://cs.example/messages", auth: "Bearer cs-token" },
    { url: "https://orders.example/messages", auth: "Bearer orders-token" },
  ]);
  // An engine with no settings fails as unavailable instead of falling back.
  await assert.rejects(
    createOpenWaTransport({ url: undefined, token: undefined }).sendText("+966500000000", "x"),
    (error) => error.name === "EngineUnavailableError",
  );
});

test("an edited message corrects the original instead of arriving as a blank bubble", async () => {
  // The stand-in client answers every select with `pendingAppSends`; here that
  // is the stored original (`slice` only keeps the update chain happy).
  const original = { id: "m-1", content: "يعطيكم العافيع", metadata: { provider: "openwa" }, slice: () => [] };
  const { send, calls } = webhook({ pendingAppSends: original });
  const edit = { type: "edit", waMessageId: "wa-original", body: "يعطيكم العافية", fromMe: false, timestamp: 1795000000 };
  const res = await send(edit, "cs-test-token");
  assert.equal(res.status, 200);
  assert.equal((await res.json()).edited, true);
  assert.equal(calls.messages.length, 0, "an edit never stores a new message");
  assert.equal(calls.claimed.length, 1);
  assert.equal(calls.claimed[0].content, "يعطيكم العافية");
  assert.equal(calls.claimed[0].metadata.original_content, "يعطيكم العافيع");
  assert.equal(calls.claimed[0].metadata.provider, "openwa");
  // An edit with no text, or no target, is rejected before anything is read.
  for (const bad of [{ ...edit, body: " " }, { ...edit, waMessageId: "" }, { ...edit, fromMe: "no" }]) {
    assert.equal((await send(bad, "cs-test-token")).status, 400);
  }
});
