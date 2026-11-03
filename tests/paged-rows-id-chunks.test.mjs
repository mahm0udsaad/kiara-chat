import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const code = ts.transpileModule(readFileSync(new URL("../src/lib/paged-rows.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
new Function("require", "module", "exports", code)(() => ({}), mod, mod.exports);
const { rowsByIdChunks } = mod.exports;

const ids = Array.from({ length: 702 }, (_, i) => `id-${String(i).padStart(3, "0")}`);

test("a month of order ids goes out in short slices, every row comes back in order", async () => {
  const sent = [];
  const rows = await rowsByIdChunks(ids, async (slice) => {
    sent.push(slice.length);
    await new Promise((r) => setTimeout(r, Math.random() * 5));
    return { data: slice.map((id) => ({ id })), error: null };
  });
  assert.ok(Math.max(...sent) <= 150);
  assert.deepEqual(rows.map((r) => r.id), ids);
});

test("no ids, no requests", async () => {
  let calls = 0;
  assert.deepEqual(await rowsByIdChunks([], async () => (calls++, { data: [], error: null })), []);
  assert.equal(calls, 0);
});

test("a failed slice fails the lookup instead of silently dropping rows", async () => {
  await assert.rejects(
    rowsByIdChunks(ids, async (slice) =>
      slice.includes("id-400") ? { data: null, error: { message: "Bad Request" } } : { data: [], error: null }),
    /Bad Request/,
  );
});
