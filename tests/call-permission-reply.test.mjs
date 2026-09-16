import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Same loader the OpenWA inbox tests use: transpile the real module and hand
// it stubbed dependencies, so the parser under test is the one that actually
// ships rather than a copy. `./meta-api` is stubbed because the parser does
// not touch Graph — importing it for real would demand credentials.
function load(path, imports = {}) {
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
  new Function("require", "module", "exports", code)(
    require,
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}

const { parseCallPermissionReply } = load("src/lib/transport/meta-calling.ts", {
  "./meta-api": {
    metaCloudConfig: () => ({ phoneNumberId: "test-phone-id" }),
    metaGraphCall: async () => {
      throw new Error("the parser must not reach Graph");
    },
  },
});

/**
 * This parser runs inside `ingestMessage`, which carries the spa's entire live
 * customer inbox. Every case below is really one assertion: a payload it does
 * not understand must come back as null, never as a throw.
 */

test("a permanent grant is recognised", () => {
  const reply = parseCallPermissionReply({
    interactive: {
      type: "call_permission_reply",
      call_permission_reply: {
        response: "accept",
        is_permanent: true,
        response_source: "user_action",
      },
    },
    context: { id: "wamid.REQUEST" },
  });
  assert.equal(reply?.response, "accept");
  assert.equal(reply?.isPermanent, true);
  assert.equal(reply?.expiresAt, null);
  assert.equal(reply?.responseSource, "user_action");
  assert.equal(reply?.requestMessageSid, "wamid.REQUEST");
});

test("a temporary grant keeps its expiry, even as a string", () => {
  // Meta sends unix seconds; the field has arrived as both a number and a
  // numeric string depending on API version.
  const asNumber = parseCallPermissionReply({
    interactive: {
      type: "call_permission_reply",
      call_permission_reply: {
        response: "accept",
        is_permanent: false,
        expiration_timestamp: 1789000000,
      },
    },
  });
  const asString = parseCallPermissionReply({
    interactive: {
      type: "call_permission_reply",
      call_permission_reply: {
        response: "accept",
        is_permanent: false,
        expiration_timestamp: "1789000000",
      },
    },
  });
  assert.equal(asNumber?.expiresAt, 1789000000);
  assert.equal(asString?.expiresAt, 1789000000);
});

test("automatic permission from a callback is distinguishable", () => {
  // callback_permission_status grants permission for free when the customer
  // calls the business first. It must not be reported as a deliberate tap.
  const reply = parseCallPermissionReply({
    interactive: {
      type: "call_permission_reply",
      call_permission_reply: { response: "accept", response_source: "automatic" },
    },
  });
  assert.equal(reply?.responseSource, "automatic");
});

test("a decline is recognised and carries no expiry", () => {
  const reply = parseCallPermissionReply({
    interactive: {
      type: "call_permission_reply",
      call_permission_reply: { response: "reject", is_permanent: false },
    },
  });
  assert.equal(reply?.response, "reject");
  assert.equal(reply?.isPermanent, false);
  assert.equal(reply?.expiresAt, null);
});

test("an ordinary button reply is not a permission reply", () => {
  const reply = parseCallPermissionReply({
    interactive: {
      type: "button_reply",
      button_reply: { id: "confirm", title: "تأكيد" },
    },
  });
  assert.equal(reply, null);
});

test("messages with no interactive payload are ignored", () => {
  assert.equal(parseCallPermissionReply({}), null);
  assert.equal(parseCallPermissionReply({ interactive: undefined }), null);
});

test("a drifted payload returns null instead of throwing", () => {
  // The whole point: a shape change at Meta's end must not take down message
  // ingestion. Each of these is a plausible drift.
  const drifted = [
    { interactive: { type: "call_permission_reply" } },
    { interactive: { type: "call_permission_reply", call_permission_reply: {} } },
    {
      interactive: {
        type: "call_permission_reply",
        call_permission_reply: { response: "maybe" },
      },
    },
    { interactive: { type: "call_permission_reply", call_permission_reply: null } },
    { interactive: null },
    { interactive: "call_permission_reply" },
    { interactive: { type: "call_permission_reply" }, context: null },
  ];
  for (const message of drifted) {
    assert.doesNotThrow(() => parseCallPermissionReply(message));
    assert.equal(parseCallPermissionReply(message), null);
  }
});

test("a reply without context still parses", () => {
  // The correlation id is a convenience, not a requirement: the customer's
  // phone already identifies which permission row this answers.
  const reply = parseCallPermissionReply({
    interactive: {
      type: "call_permission_reply",
      call_permission_reply: { response: "accept", is_permanent: true },
    },
  });
  assert.equal(reply?.requestMessageSid, null);
});
