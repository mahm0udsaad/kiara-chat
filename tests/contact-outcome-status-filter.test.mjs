import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const code = ts.transpileModule(readFileSync(new URL("../src/lib/contact-outcome.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
new Function("require", "module", "exports", code)(() => ({}), loaded, loaded.exports);
const { matchesStatusFilter } = loaded.exports;

test("a chat closed as «لم يتم الحجز» or «لم ترد العميلة» is not under «تم الطلب»", () => {
  assert.equal(matchesStatusFilter("resolved", "not_booked", "resolved"), false);
  assert.equal(matchesStatusFilter("resolved", "no_reply", "resolved"), false);
});

test("booked or outcome-less closed chats stay under «تم الطلب»", () => {
  assert.equal(matchesStatusFilter("resolved", "booked", "resolved"), true);
  assert.equal(matchesStatusFilter("resolved", null, "resolved"), true);
});

test("other statuses filter as before", () => {
  assert.equal(matchesStatusFilter("waiting", "not_booked", "waiting"), true);
  assert.equal(matchesStatusFilter("open", null, "resolved"), false);
});
