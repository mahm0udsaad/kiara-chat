"use client";

import { useCallback, useMemo, useState } from "react";
import { BookOpen, Check, Eye, EyeOff, Loader2, Pencil, Plus, Search, X } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import type { CatalogItem } from "@/lib/catalog";

/**
 * The spa's services and packages: what the composer's catalogue button offers
 * and what the bot quotes. Items are hidden rather than deleted — the same rows
 * feed the parent app, and hiding is reversible.
 */
export function CatalogManager({ initial }: { initial: CatalogItem[] }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(initial);

  const visible = items.filter((i) => i.isAvailable).length;
  const categories = new Set(items.map((i) => i.category)).size;

  return (
    <section className="mt-6 space-y-3 rounded-2xl border bg-[var(--surface)] p-4">
      <div className="flex items-center gap-2">
        <BookOpen size={18} className="text-[var(--brand)]" aria-hidden="true" />
        <h2 className="font-semibold text-[var(--foreground)]">الباقات والخدمات</h2>
      </div>
      <p className="text-sm text-[var(--muted)]">
        شرح كل باقة وسعرها. يظهر لكِ في زر الباقات داخل المحادثة لإدراجه بضغطة،
        ويعتمد عليه البوت في رده على الأسعار.
      </p>
      <p className="text-sm text-[var(--foreground)]">
        {items.length.toLocaleString("ar")} خدمة في {categories.toLocaleString("ar")} قسمًا
        {visible < items.length
          ? ` · ${(items.length - visible).toLocaleString("ar")} مخفية`
          : ""}
      </p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border px-4 text-sm font-medium text-[var(--brand)]"
      >
        إدارة الباقات والخدمات
      </button>

      <CatalogSheet open={open} onClose={() => setOpen(false)} items={items} onItems={setItems} />
    </section>
  );
}

function CatalogSheet({
  open,
  onClose,
  items,
  onItems,
}: {
  open: boolean;
  onClose: () => void;
  items: CatalogItem[];
  onItems: (updater: (prev: CatalogItem[]) => CatalogItem[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [adding, setAdding] = useState(false);

  const categories = useMemo(
    () => [...new Set(items.map((i) => i.category))].sort((a, b) => a.localeCompare(b, "ar")),
    [items]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => {
      if (category !== "all" && i.category !== category) return false;
      if (!q) return true;
      return i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q);
    });
  }, [items, query, category]);

  return (
    <Modal open={open} onClose={onClose} title="الباقات والخدمات">
      <div className="space-y-3">
        <div className="relative">
          <Search
            size={15}
            aria-hidden="true"
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--subtle)]"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحثي عن خدمة أو باقة…"
            className="min-h-11 w-full rounded-xl border pr-9 pl-3 text-sm outline-none focus:border-[var(--brand)]"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Chip active={category === "all"} onClick={() => setCategory("all")}>
            الكل
          </Chip>
          {categories.map((c) => (
            <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
              {c}
            </Chip>
          ))}
        </div>

        {adding ? (
          <AddForm
            categories={categories}
            defaultCategory={category === "all" ? categories[0] ?? "" : category}
            onCancel={() => setAdding(false)}
            onAdded={(item) => {
              onItems((prev) => [item, ...prev]);
              setAdding(false);
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex min-h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed text-sm text-[var(--brand)]"
          >
            <Plus size={14} /> إضافة خدمة أو باقة
          </button>
        )}

        <p className="text-xs text-[var(--subtle)]">
          {filtered.length.toLocaleString("ar")} من {items.length.toLocaleString("ar")}
        </p>

        <ul className="space-y-2">
          {filtered.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              onSaved={(next) =>
                onItems((prev) => prev.map((i) => (i.id === next.id ? next : i)))
              }
            />
          ))}
        </ul>
      </div>
    </Modal>
  );
}

function AddForm({
  categories,
  defaultCategory,
  onCancel,
  onAdded,
}: {
  categories: string[];
  defaultCategory: string;
  onCancel: () => void;
  onAdded: (item: CatalogItem) => void;
}) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState(defaultCategory);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setError(null);
    if (!name.trim()) return setError("الاسم مطلوب");
    setBusy(true);
    try {
      const res = await fetch("/api/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          price: price.trim() === "" ? null : Number(price),
          category: category.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data?.error ?? "تعذّرت الإضافة");
      onAdded(data.item as CatalogItem);
    } catch {
      setError("تعذّرت الإضافة");
    } finally {
      setBusy(false);
    }
  }, [name, price, description, category, onAdded]);

  return (
    <div className="space-y-2 rounded-xl border border-dashed p-3">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="اسم الخدمة أو الباقة"
        className="min-h-11 w-full rounded-lg border px-3 text-sm outline-none focus:border-[var(--brand)]"
      />
      <div className="flex gap-2">
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          type="number"
          min={0}
          inputMode="decimal"
          placeholder="السعر"
          className="min-h-11 w-28 rounded-lg border px-3 text-sm tabular-nums outline-none focus:border-[var(--brand)]"
        />
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          list="catalog-categories"
          placeholder="القسم"
          className="min-h-11 w-full rounded-lg border px-3 text-sm outline-none focus:border-[var(--brand)]"
        />
        <datalist id="catalog-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
        placeholder="الشرح كما يُرسل للزبونة"
        className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-[var(--brand)]"
      />
      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--brand)] text-sm font-medium text-white disabled:opacity-60"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          حفظ
        </button>
        <button
          type="button"
          onClick={onCancel}
          aria-label="إلغاء"
          className="flex size-10 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-black/5"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

function ItemRow({
  item,
  onSaved,
}: {
  item: CatalogItem;
  onSaved: (next: CatalogItem) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [price, setPrice] = useState(item.price == null ? "" : String(item.price));
  const [description, setDescription] = useState(item.description);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/catalog/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error ?? "تعذّر التحديث");
          return false;
        }
        onSaved(data.item as CatalogItem);
        return true;
      } catch {
        setError("تعذّر التحديث");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [item.id, onSaved]
  );

  if (editing) {
    return (
      <li className="space-y-2 rounded-xl border p-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-h-10 w-full rounded-lg border px-2 text-sm outline-none focus:border-[var(--brand)]"
        />
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          type="number"
          min={0}
          inputMode="decimal"
          placeholder="السعر"
          className="min-h-10 w-28 rounded-lg border px-2 text-sm tabular-nums outline-none focus:border-[var(--brand)]"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          placeholder="الشرح"
          className="w-full rounded-lg border px-2 py-2 text-sm outline-none focus:border-[var(--brand)]"
        />
        {error ? <p className="text-xs text-rose-600">{error}</p> : null}
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={async () => {
              const ok = await patch({
                name,
                description,
                price: price.trim() === "" ? null : Number(price),
              });
              if (ok) setEditing(false);
            }}
            disabled={busy}
            className="flex min-h-9 flex-1 items-center justify-center gap-1 rounded-lg bg-[var(--brand)] text-sm text-white disabled:opacity-60"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={15} />}
            حفظ
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setName(item.name);
              setPrice(item.price == null ? "" : String(item.price));
              setDescription(item.description);
            }}
            aria-label="إلغاء"
            className="flex size-9 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-black/5"
          >
            <X size={16} />
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className={cn("rounded-xl border p-3", !item.isAvailable && "opacity-55")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[var(--foreground)]">
            {item.name}
            {item.price != null ? (
              <span className="mr-2 text-xs tabular-nums text-[var(--brand)]">
                {item.price.toLocaleString("ar-SA")} ر.س
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 whitespace-pre-wrap text-xs text-[var(--muted)]">
            {item.description || "لا يوجد شرح — أضيفيه ليظهر للزبونة."}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label="تعديل"
            className="flex size-9 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-black/5"
          >
            <Pencil size={15} />
          </button>
          <button
            type="button"
            onClick={() => patch({ isAvailable: !item.isAvailable })}
            disabled={busy}
            aria-label={item.isAvailable ? "إخفاء" : "إظهار"}
            className={cn(
              "flex size-9 items-center justify-center rounded-lg hover:bg-black/5 disabled:opacity-50",
              item.isAvailable ? "text-[var(--muted)]" : "text-emerald-600"
            )}
          >
            {busy ? (
              <Loader2 size={15} className="animate-spin" />
            ) : item.isAvailable ? (
              <EyeOff size={15} />
            ) : (
              <Eye size={15} />
            )}
          </button>
        </div>
      </div>
      {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
    </li>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "min-h-8 rounded-full border px-2.5 text-[11px] transition-colors",
        active
          ? "border-[var(--brand)] bg-[var(--brand)] text-white"
          : "text-[var(--muted)] hover:bg-[var(--brand-soft)]"
      )}
    >
      {children}
    </button>
  );
}
