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

function storageStub(results) {
  const calls = [];
  const client = {
    storage: {
      from: () => ({
        upload: async (path, _buf, opts) => {
          calls.push({ path, upsert: opts.upsert });
          const next = results.shift();
          if (next instanceof Error) throw next;
          return { error: next };
        },
      }),
    },
  };
  return { calls, imports: { crypto: { randomUUID: () => "00000000-0000-0000-0000-000000000000" }, "@/lib/supabase/admin": { getAdminSupabaseClient: () => client } } };
}

const params = { restaurantId: "r", conversationId: "c", contentType: "audio/ogg", base64: "YQ==" };

test("a timed-out upload is retried on the same path and stored", async () => {
  const stub = storageStub([new Error("Supabase request timed out"), null]);
  const { uploadBase64Media } = load("src/lib/storage-media.ts", stub.imports);
  const slot = await uploadBase64Media(params);
  assert.equal(slot.delivery_status, "stored");
  assert.equal(stub.calls.length, 2);
  assert.equal(stub.calls[0].path, stub.calls[1].path);
  assert.deepEqual(stub.calls.map((c) => c.upsert), [false, true]);
});

test("an upload that keeps failing gives up after three tries with the reason", async () => {
  const stub = storageStub([new Error("t1"), { message: "t2" }, new Error("Supabase request timed out")]);
  const { uploadBase64Media } = load("src/lib/storage-media.ts", stub.imports);
  const slot = await uploadBase64Media(params);
  assert.equal(stub.calls.length, 3);
  assert.equal(slot.delivery_status, "failed");
  assert.equal(slot.storage_path, null);
  assert.equal(slot.fetch_error, "upload: Supabase request timed out");
});

test("only recent failed Meta files with retries left are picked for healing", () => {
  const { messagesNeedingHeal } = load("src/lib/media-heal.ts", {
    "server-only": {},
    "@/lib/supabase/admin": {},
    "@/lib/tenant": { KIARA_RESTAURANT_ID: "r" },
    "@/lib/transport/meta": {},
    "@/lib/storage-media": {},
  });
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 40 * 864e5).toISOString();
  const failed = { storage_path: null, delivery_status: "failed", provider_media_id: "m1" };
  const rows = [
    { id: "heal", created_at: now, metadata: { media: [failed] } },
    { id: "stored", created_at: now, metadata: { media: [{ ...failed, storage_path: "x", delivery_status: "stored" }] } },
    { id: "no-id", created_at: now, metadata: { media: [{ ...failed, provider_media_id: null }] } },
    { id: "too-old", created_at: old, metadata: { media: [failed] } },
    { id: "spent", created_at: now, metadata: { media: [{ ...failed, heal_attempts: 3 }] } },
    { id: "too-large", created_at: now, metadata: { media: [{ ...failed, delivery_status: "too_large" }] } },
    { id: "text", created_at: now, metadata: null },
  ];
  assert.deepEqual(messagesNeedingHeal(rows), ["heal"]);
});
