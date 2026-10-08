import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import ts from "typescript";

// The planner is pure; the IO dependencies are only stubbed so the module loads.
function load(path, imports = {}) {
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  const require = (name) => {
    assert.ok(name in imports, `Unexpected dependency: ${name}`);
    return imports[name];
  };
  new Function("require", "module", "exports", "process", code)(
    require, loadedModule, loadedModule.exports, { env: {} },
  );
  return loadedModule.exports;
}

const catalog = load("src/lib/rekaz-catalog.ts", {
  crypto,
  "@/lib/http-timeout": {},
  "@/lib/supabase/admin": {},
  "@/lib/tenant": { KIARA_RESTAURANT_ID: "tenant-1" },
});

const service = (name, extra = {}) => ({
  rekazId: `r-${name}`,
  name,
  price: 100,
  options: [{ price: 100, durationMinutes: 60 }],
  category: "قسم المساج",
  imageUrl: "https://cdn.rekaz.io/x.webp",
  type: "Reservation",
  ...extra,
});
const row = (id, name, extra = {}) => ({
  id,
  name_ar: name,
  description_ar: "وصف مكتوب",
  price: 100,
  category: "قسم المساج",
  image_url: "https://cdn.rekaz.io/x.webp",
  is_available: true,
  ...extra,
});

test("a service added in Rekaz is inserted; an unchanged one is left alone", () => {
  const plan = catalog.planCatalogSync(
    [row("1", "مساج سويدي 🍃")],
    [service("مساج سويدي 🍃"), service("مسـاج البقشه التايلنديه 🍃", { price: 290 })],
  );
  assert.deepEqual(plan.insert.map((s) => s.name), ["مسـاج البقشه التايلنديه 🍃"]);
  assert.equal(plan.update.length, 0);
});

test("emoji, tatweel, English suffixes and double spaces do not read as a new service", () => {
  const plan = catalog.planCatalogSync(
    [row("1", "مساج الحامل")],
    [service(catalog.cleanServiceName("مسـاج الحامل  🍃  Air Cupping Massage"))],
  );
  assert.equal(plan.insert.length, 0);
  assert.deepEqual(plan.update[0].changes, ["الاسم"]);
});

test("price, section, photo and a hidden row follow Rekaz; a written description is kept", () => {
  const plan = catalog.planCatalogSync(
    [row("1", "مساج الأقدام", { price: 150, category: "أخرى", image_url: null, is_available: false })],
    [service("مساج الأقدام", { price: 120 })],
  );
  assert.deepEqual(plan.update[0].changes, ["السعر", "القسم", "الصورة", "أُعيد إظهارها"]);
  assert.equal(plan.update[0].patch.price, 120);
  assert.equal("description_ar" in plan.update[0].patch, false);
});

test("nothing is hidden: rows missing from the Rekaz site are only reported", () => {
  const plan = catalog.planCatalogSync(
    [row("1", "مساج سويدي"), row("2", "قسيمه للإهداء 🎁"), row("3", "قديمة", { is_available: false })],
    [service("مساج سويدي")],
  );
  assert.deepEqual(plan.notOnRekaz, ["قسيمه للإهداء 🎁"]);
  assert.ok(plan.update.every((u) => u.patch.is_available !== false));
});

test("a section-less Rekaz service keeps its section here", () => {
  const plan = catalog.planCatalogSync(
    [row("1", "لف اطراف")],
    [service("لف اطراف", { category: null })],
  );
  assert.equal(plan.update.length, 0);
});

test("an exact name is never stolen by a looser one", () => {
  const plan = catalog.planCatalogSync(
    [row("1", "قص الشعر"), row("2", "قص الشعر مدرجات")],
    [service("قص الشعر مدرجات"), service("قص الشعر")],
  );
  assert.equal(plan.insert.length, 0);
  assert.equal(plan.notOnRekaz.length, 0);
});

test("descriptions say only what the numbers can", () => {
  assert.equal(
    catalog.describeNewService(service("مساج", {
      options: [{ price: 120, durationMinutes: 30 }, { price: 150, durationMinutes: 40 }],
    })),
    "30 دقيقة — 120 ر.س\n40 دقيقة — 150 ر.س",
  );
  assert.equal(
    catalog.describeNewService(service("بديكير", {
      options: [{ price: 189, durationMinutes: 90 }, { price: 39, durationMinutes: 10 }, { price: 5, durationMinutes: 10 }],
    })),
    "تبدأ الأسعار من 5 ر.س",
  );
  assert.equal(catalog.arabicServiceDuration(140), "ساعتين و20 دقيقة");
  assert.equal(catalog.arabicServiceDuration(360), "6 ساعات");
});
