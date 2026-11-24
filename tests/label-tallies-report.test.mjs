import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// The «التصنيفات» card in the customer-service report: how many times each
// followed label was ticked, and by which employee.

const code = ts.transpileModule(
  readFileSync(new URL("../src/lib/label-report.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
const loaded = { exports: {} };
new Function("module", "exports", "require", code)(loaded, loaded.exports, (name) => {
  if (name === "@/lib/tenant") return { KIARA_RESTAURANT_ID: "tenant" };
  throw new Error(`unexpected import ${name}`);
});
const { tallyLabels } = loaded.exports;

const labels = [
  { id: "call", name: "تم التواصل مكالمة", color: "red" },
  { id: "deposit", name: "انتظارعربون للتسجيل", color: "blue" },
  { id: "ask", name: "استفسار عن طريق الاتصال", color: "emerald" },
  { id: "other", name: "شكوى", color: "red" },
];
const members = [
  { id: "tm-1", user_id: "u-1", full_name: "منه" },
  { id: "tm-2", user_id: "u-2", full_name: "رحمة" },
];
const at = "2026-11-20T10:00:00Z";

test("counts only the followed labels, in the owner's order, despite spelling drift", () => {
  const result = tallyLabels(labels, [], members);
  assert.deepEqual(result.map((t) => t.id), ["call", "ask", "deposit"]);
  assert.ok(result.every((t) => t.total === 0 && t.employees.length === 0));
});

test("splits each label by the employee who ticked it, most first", () => {
  const rows = [
    { label_id: "call", assigned_by: "u-1", assigned_at: at },
    { label_id: "call", assigned_by: "u-2", assigned_at: at },
    { label_id: "call", assigned_by: "u-2", assigned_at: at },
    { label_id: "call", assigned_by: null, assigned_at: at },
    { label_id: "other", assigned_by: "u-1", assigned_at: at },
  ];
  const call = tallyLabels(labels, rows, members).find((t) => t.id === "call");
  assert.equal(call.total, 4);
  assert.deepEqual(call.employees, [
    { memberId: "tm-2", name: "رحمة", count: 2 },
    { memberId: "tm-1", name: "منه", count: 1 },
    { memberId: null, name: "غير معروف", count: 1 },
  ]);
});
