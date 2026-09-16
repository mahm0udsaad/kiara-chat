import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHmac, timingSafeEqual } from "node:crypto";
import ts from "typescript";

/**
 * The Meta webhook carries the spa's entire live customer inbox, and calling
 * had to be added to it. These tests exist to prove one thing above all: a
 * call event travels a path that cannot touch message ingestion, and message
 * ingestion behaves exactly as it did before.
 */

const APP_SECRET = "test-app-secret";

function load(path, imports = {}, env = {}) {
  const code = ts.transpileModule(
    readFileSync(new URL(`../${path}`, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const loadedModule = { exports: {} };
  const require = (name) => {
    assert.ok(name in imports, `Unexpected dependency: ${name}`);
    return imports[name];
  };
  new Function("require", "module", "exports", "process", code)(
    require,
    loadedModule,
    loadedModule.exports,
    { env },
  );
  return loadedModule.exports;
}

const metaCalling = load("src/lib/transport/meta-calling.ts", {
  "./meta-api": {
    metaCloudConfig: () => ({ phoneNumberId: "PHONE" }),
    metaGraphCall: async () => {
      throw new Error("the webhook must not call Graph inline");
    },
    metaErrorCode: () => null,
  },
});

function webhook({ customerProvider = "meta" } = {}) {
  const seen = {
    messages: [],
    activity: [],
    jobs: [],
    calls: [],
    permissionReplies: [],
    transport: [],
  };

  const { POST } = load(
    "src/app/api/webhooks/meta/route.ts",
    {
      crypto: { createHmac, timingSafeEqual },
      "next/server": {
        NextResponse: Response,
        after: (job) => seen.jobs.push(job),
      },
      "@/lib/transport/inbox-provider": { inboxProvider: () => "meta" },
      "@/lib/transport": { customerProvider: () => customerProvider },
      "@/lib/bot/reply": { runBotTurn: async () => {} },
      "@/lib/inbox-notifications": { notifyInboundInboxMessage: async () => {} },
      "@/lib/tenant": { KIARA_RESTAURANT_ID: "tenant" },
      "@/lib/transport/meta-api": {
        metaCloudConfig: () => ({
          appSecret: APP_SECRET,
          phoneNumberId: "PHONE",
          verifyToken: "verify",
        }),
      },
      "@/lib/transport/meta": { downloadMetaMedia: async () => {
        throw new Error("no media in these fixtures");
      } },
      "@/lib/transport/meta-calling": metaCalling,
      "@/lib/call-permissions": {
        applyCallPermissionReply: async (...args) =>
          seen.permissionReplies.push(args),
      },
      "@/lib/calls": {
        ingestCalls: async (value) => seen.calls.push(value),
      },
      "@/lib/server-conversations": {
        hasMessageWithSid: async () => false,
        findOrCreateConversation: async () => ({ id: "conversation" }),
        rememberConversationTransport: async (...args) =>
          seen.transport.push(args),
        saveMessage: async (message) => {
          seen.messages.push(message);
          return "message-row";
        },
        bumpConversationActivity: async (...args) => seen.activity.push(args),
        updateDeliveryStatus: async () => {},
      },
      "@/lib/storage-media": {
        uploadBase64Media: async () => ({}),
        messageTypeFromContentType: () => "image",
      },
    },
    {},
  );

  const send = (payload, secret = APP_SECRET) => {
    const raw = JSON.stringify(payload);
    const signature = createHmac("sha256", secret).update(raw).digest("hex");
    return POST(
      new Request("https://app.example/api/webhooks/meta", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": `sha256=${signature}`,
        },
        body: raw,
      }),
    );
  };

  return { send, seen };
}

const envelope = (field, value) => ({
  object: "whatsapp_business_account",
  entry: [{ changes: [{ field, value }] }],
});

const textMessage = envelope("messages", {
  metadata: { display_phone_number: "966508421748", phone_number_id: "PHONE" },
  contacts: [{ wa_id: "966501234567", profile: { name: "نورة" } }],
  messages: [
    {
      id: "wamid.TEXT",
      from: "966501234567",
      timestamp: "1789000000",
      type: "text",
      text: { body: "السلام عليكم" },
    },
  ],
});

const callConnect = envelope("calls", {
  metadata: { display_phone_number: "966508421748", phone_number_id: "PHONE" },
  calls: [
    {
      id: "wacid.ABC",
      from: "966501234567",
      to: "966508421748",
      event: "connect",
      direction: "BUSINESS_INITIATED",
      session: { sdp_type: "answer", sdp: "v=0\r\n" },
    },
  ],
});

test("an ordinary text message still ingests unchanged", async () => {
  const { send, seen } = webhook();
  const response = await send(textMessage);

  assert.equal(response.status, 200);
  assert.equal(seen.messages.length, 1);
  assert.equal(seen.messages[0].content, "السلام عليكم");
  assert.equal(seen.messages[0].role, "customer");
  assert.equal(seen.messages[0].externalMessageSid, "wamid.TEXT");
  assert.equal(seen.activity.length, 1);
  // Nothing about calling was touched.
  assert.equal(seen.calls.length, 0);
  assert.equal(seen.permissionReplies.length, 0);
});

test("a calls event reaches ingestCalls and never the message path", async () => {
  const { send, seen } = webhook();
  const response = await send(callConnect);

  assert.equal(response.status, 200);
  assert.equal(seen.calls.length, 1);
  assert.equal(seen.calls[0].calls[0].id, "wacid.ABC");
  // The load-bearing assertion: a call cannot create a message, bump a
  // conversation, or wake the bot.
  assert.equal(seen.messages.length, 0);
  assert.equal(seen.activity.length, 0);
  assert.equal(seen.jobs.length, 0);
});

test("the messaging standby switch no longer silences call signalling", async () => {
  // Before calling existed, this flag returned early for the whole request.
  // Leaving it that way would drop live SDP the day anyone flipped the
  // messaging provider — a call that rings and never connects.
  const { send, seen } = webhook({ customerProvider: "twilio" });

  await send(textMessage);
  assert.equal(seen.messages.length, 0, "messages stay on standby");

  await send(callConnect);
  assert.equal(seen.calls.length, 1, "calls are delivered regardless");
});

test("a call permission reply is stored readably and applied out of band", async () => {
  const { send, seen } = webhook();
  await send(
    envelope("messages", {
      metadata: { phone_number_id: "PHONE" },
      messages: [
        {
          id: "wamid.PERM",
          from: "966501234567",
          timestamp: "1789000000",
          type: "interactive",
          context: { id: "wamid.REQUEST" },
          interactive: {
            type: "call_permission_reply",
            call_permission_reply: {
              response: "accept",
              is_permanent: false,
              expiration_timestamp: 1789600000,
              response_source: "user_action",
            },
          },
        },
      ],
    }),
  );

  // It would otherwise render as an empty bubble: a permission reply carries
  // no text of its own.
  assert.equal(seen.messages.length, 1);
  assert.match(seen.messages[0].content, /سمحت العميلة/);
  assert.equal(
    seen.messages[0].metadata.interactive.type,
    "call_permission_reply",
  );

  // Deferred, so permission bookkeeping can never fail inbox ingestion.
  assert.equal(seen.permissionReplies.length, 0);
  await Promise.all(seen.jobs.map((job) => job()));
  assert.equal(seen.permissionReplies.length, 1);
  assert.equal(seen.permissionReplies[0][1], "+966501234567");
  assert.equal(seen.permissionReplies[0][2].response, "accept");
});

test("a declined permission reply reads as a refusal", async () => {
  const { send, seen } = webhook();
  await send(
    envelope("messages", {
      metadata: { phone_number_id: "PHONE" },
      messages: [
        {
          id: "wamid.PERM2",
          from: "966501234567",
          type: "interactive",
          interactive: {
            type: "call_permission_reply",
            call_permission_reply: { response: "reject" },
          },
        },
      ],
    }),
  );
  assert.match(seen.messages[0].content, /رفضت العميلة/);
});

test("an unsigned or wrongly signed payload is refused before any work", async () => {
  const { send, seen } = webhook();
  const response = await send(callConnect, "the-wrong-secret");
  assert.equal(response.status, 403);
  assert.equal(seen.calls.length, 0);
  assert.equal(seen.messages.length, 0);
});

test("an unknown webhook field is ignored rather than mistaken for either", async () => {
  const { send, seen } = webhook();
  const response = await send(envelope("message_template_status_update", {}));
  assert.equal(response.status, 200);
  assert.equal(seen.calls.length, 0);
  assert.equal(seen.messages.length, 0);
});
