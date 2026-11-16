import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const code = ts.transpileModule(
  readFileSync(new URL("../src/lib/whatsapp-senders-core.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
const loaded = { exports: {} };
new Function("require", "module", "exports", code)(() => ({}), loaded, loaded.exports);
const { pickSender, opensMetaWindow, parseSenderId, SenderError, DEFAULT_SENDER_ID } = loaded.exports;

const row = (id, extra = {}) => ({
  id,
  provider: id === "meta" ? "meta" : "openwa",
  phone: null,
  label: id,
  enabled: true,
  allowed_roles: ["admin", "agent"],
  sort_order: 0,
  ...extra,
});
const rows = [row("meta"), row("openwa_cs"), row("openwa_admin", { allowed_roles: ["admin"] }), row("off", { enabled: false })];

const code_ = (fn) => {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof SenderError, "throws SenderError");
    return error.code;
  }
  assert.fail("expected a SenderError");
};

test("an explicit pick wins over the saved choice, which wins over the default", () => {
  assert.equal(pickSender(rows, { requested: "openwa_cs", saved: "meta", role: "agent" }).id, "openwa_cs");
  assert.equal(pickSender(rows, { requested: null, saved: "openwa_cs", role: "agent" }).id, "openwa_cs");
  assert.equal(pickSender(rows, { requested: undefined, saved: null, role: "agent" }).id, DEFAULT_SENDER_ID);
});

test("there is no fallback: unknown, forbidden and disabled senders are errors", () => {
  assert.equal(code_(() => pickSender(rows, { requested: "nope", saved: null, role: "agent" })), "SENDER_UNKNOWN");
  assert.equal(code_(() => pickSender(rows, { requested: "openwa_admin", saved: null, role: "agent" })), "SENDER_FORBIDDEN");
  assert.equal(pickSender(rows, { requested: "openwa_admin", saved: null, role: "admin" }).id, "openwa_admin");
  assert.equal(code_(() => pickSender(rows, { requested: "off", saved: null, role: "admin" })), "SENDER_DISABLED");
  // A bad saved choice is an error too, not a silent switch to Meta.
  assert.equal(code_(() => pickSender(rows, { requested: null, saved: "off", role: "admin" })), "SENDER_DISABLED");
});

test("system sends with no role skip only the role rule", () => {
  assert.equal(pickSender(rows, { requested: "openwa_admin", saved: null }).id, "openwa_admin");
  assert.equal(code_(() => pickSender(rows, { requested: "off", saved: null })), "SENDER_DISABLED");
});

test("errors carry HTTP status and Arabic text for the composer", () => {
  const error = new SenderError("SENDER_UNAVAILABLE", "openwa_cs", "disconnected");
  assert.equal(error.status, 503);
  assert.match(error.message, /غير متصل/);
});

test("only Meta inbound (and history) opens Meta's 24-hour window", () => {
  assert.equal(opensMetaWindow(null), true);
  assert.equal(opensMetaWindow(undefined), true);
  assert.equal(opensMetaWindow("meta"), true);
  assert.equal(opensMetaWindow("openwa_cs"), false);
  assert.equal(opensMetaWindow("openwa"), false);
});

test("sender ids from a request are checked before use", () => {
  assert.equal(parseSenderId("openwa_cs"), "openwa_cs");
  assert.equal(parseSenderId("meta"), "meta");
  for (const bad of ["", "OPENWA", "x", "a; drop table", 42, null, undefined, "openwa_cs,meta"]) {
    assert.equal(parseSenderId(bad), null, String(bad));
  }
});
