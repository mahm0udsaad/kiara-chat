import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

/**
 * Ground truth, not guesswork.
 *
 * The fixture below is a byte-for-byte copy of a real
 * GET /<PHONE_NUMBER_ID>/call_permissions response, captured in production on
 * 2026-09-16 for a customer who had granted permanent permission.
 *
 * The first version of this parser guessed the shape — a `data[]` array of
 * entries with `name` and `remaining_quota` — read nothing, and reported a
 * confident "no permission". Sixty seconds after the customer accepted, the
 * reconciler took that at face value and revoked a grant she had really given.
 * These tests exist so that can never happen silently again.
 */

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

function withResponse(response) {
  return load("src/lib/transport/meta-calling.ts", {
    "./meta-api": {
      metaCloudConfig: () => ({ phoneNumberId: "PHONE" }),
      metaGraphCall: async () => response,
      metaErrorCode: () => null,
    },
  });
}

/** Verbatim from production, 2026-09-16. */
const PERMANENT_GRANT = {
  actions: [
    {
      limits: [
        { max_allowed: 1, time_period: "PT24H", current_usage: 1 },
        { max_allowed: 2, time_period: "P7D", current_usage: 1 },
      ],
      action_name: "send_call_permission_request",
      can_perform_action: false,
    },
    {
      limits: [{ max_allowed: 100, time_period: "PT24H", current_usage: 0 }],
      action_name: "start_call",
      can_perform_action: true,
    },
  ],
  permission: { status: "permanent" },
  messaging_product: "whatsapp",
};

test("the real permanent-grant response reads as permanent and callable", async () => {
  const { fetchCallPermission } = withResponse(PERMANENT_GRANT);
  const state = await fetchCallPermission("+201279119364");

  assert.equal(state.status, "permanent");
  assert.equal(state.recognised, true);
  assert.equal(state.canCall, true, "start_call.can_perform_action is true");
  // She has already been asked once today, so asking again is not allowed —
  // the UI must not offer it.
  assert.equal(state.canRequest, false);
  assert.equal(state.expiresAt, null, "a permanent grant never expires");
});

test("a temporary grant carries its expiry", async () => {
  const { fetchCallPermission } = withResponse({
    messaging_product: "whatsapp",
    permission: { status: "temporary", expiration_timestamp: 1789600000 },
    actions: [
      { action_name: "start_call", can_perform_action: true },
      { action_name: "send_call_permission_request", can_perform_action: false },
    ],
  });
  const state = await fetchCallPermission("+966501234567");

  assert.equal(state.status, "temporary");
  assert.equal(state.expiresAt, 1789600000);
  assert.equal(state.recognised, true);
});

test("no permission is a real answer, and asking is still offered", async () => {
  const { fetchCallPermission } = withResponse({
    messaging_product: "whatsapp",
    permission: { status: "no_permission" },
    actions: [
      { action_name: "send_call_permission_request", can_perform_action: true },
      { action_name: "start_call", can_perform_action: false },
    ],
  });
  const state = await fetchCallPermission("+966501234567");

  assert.equal(state.status, "no_permission");
  assert.equal(state.recognised, true, "an explicit no is understood, not a shape failure");
  assert.equal(state.canRequest, true);
  assert.equal(state.canCall, false);
});

test("a granted permission whose call quota is spent is not callable", async () => {
  // 100 connected calls per customer per 24h. Permission stays granted; the
  // ability to place another call does not.
  const { fetchCallPermission } = withResponse({
    messaging_product: "whatsapp",
    permission: { status: "permanent" },
    actions: [
      {
        action_name: "start_call",
        can_perform_action: false,
        limits: [{ max_allowed: 100, time_period: "PT24H", current_usage: 100 }],
      },
    ],
  });
  const state = await fetchCallPermission("+966501234567");

  assert.equal(state.status, "permanent");
  assert.equal(state.canCall, false);
});

test("the shape the parser used to guess is reported as unrecognised", async () => {
  // This is precisely the payload the old parser expected. If Meta ever
  // returned it, the new parser must say "I do not understand" rather than
  // "no permission" — the distinction is what protects a live grant.
  const { fetchCallPermission } = withResponse({
    data: [{ status: "permanent", actions: [{ name: "start_call" }] }],
  });
  const state = await fetchCallPermission("+966501234567");

  assert.equal(state.recognised, false);
  assert.equal(state.status, "no_permission");
});

test("an empty or drifted response is unrecognised, never a confident no", async () => {
  for (const response of [{}, { permission: {} }, { permission: { status: "??" } }]) {
    const { fetchCallPermission } = withResponse(response);
    const state = await fetchCallPermission("+966501234567");
    assert.equal(state.recognised, false, JSON.stringify(response));
  }
});

test("missing actions default to permitted rather than hiding the controls", async () => {
  const { fetchCallPermission } = withResponse({
    messaging_product: "whatsapp",
    permission: { status: "permanent" },
  });
  const state = await fetchCallPermission("+966501234567");

  assert.equal(state.canCall, true);
  assert.equal(state.canRequest, true);
});
