"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { CatalogThumb } from "@/components/catalog-thumb";
import { cn } from "@/lib/utils";
import type { CatalogItem } from "@/lib/catalog";

/**
 * The spa's services and packages, for dropping an explanation into a reply.
 * A popup like the saved-replies one doesn't scale to ~80 items, so this is a
 * searchable sheet grouped by section. Picking an item fills the composer
 * rather than sending — the reply is still the agent's to word — and its photo
 * comes along as a staged attachment when the service has one.
 */
export function CatalogSheet({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (item: CatalogItem, text: string) => void;
}) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // `loading` starts true and the sheet is mounted only while open, so there's
    // nothing to reset here — setting state synchronously would just cascade.
    fetch("/api/catalog")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.error) setError(data.error);
        else setItems((data.items ?? []) as CatalogItem[]);
      })
      .catch(() => {
        if (!cancelled) setError("تعذّر تحميل الباقات");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const categories = useMemo(
    () => [...new Set(items.map((i) => i.category))].sort((a, b) => a.localeCompare(b, "ar")),
    [items]
  );

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = items.filter((i) => {
      if (category !== "all" && i.category !== category) return false;
      if (!q) return true;
      return (
        i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q)
      );
    });
    const out: { category: string; items: CatalogItem[] }[] = [];
    for (const item of filtered) {
      const last = out.at(-1);
      if (last?.category === item.category) last.items.push(item);
      else out.push({ category: item.category, items: [item] });
    }
    return out;
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

        {categories.length > 1 ? (
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
        ) : null}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" /> جارٍ التحميل…
          </div>
        ) : error ? (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
        ) : groups.length ? (
          <div className="space-y-4">
            {groups.map((group) => (
              <section key={group.category}>
                <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">
                  {group.category}
                </h3>
                <ul className="space-y-1.5">
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onPick(item, formatItem(item));
                          onClose();
                        }}
                        className="flex w-full items-start gap-3 rounded-xl border p-3 text-right transition-colors hover:border-[var(--brand)] hover:bg-[var(--brand-soft)]"
                      >
                        <CatalogThumb item={item} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-start justify-between gap-2">
                            <span className="min-w-0 flex-1 text-sm font-medium text-[var(--foreground)]">
                              {item.name}
                            </span>
                            {item.price != null ? (
                              <span className="shrink-0 text-xs tabular-nums text-[var(--brand)]">
                                {item.price.toLocaleString("ar-SA")} ر.س
                              </span>
                            ) : null}
                          </span>
                          {item.description ? (
                            <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">
                              {item.description}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {items.length ? "لا نتائج مطابقة." : "لا توجد باقات بعد — تُضاف من الإعدادات."}
          </p>
        )}
      </div>
    </Modal>
  );
}

/** Mirrors formatCatalogItem — kept here so the sheet stays client-only. */
function formatItem(item: CatalogItem): string {
  const price =
    item.price == null ? "" : ` — ${item.price.toLocaleString("ar-SA")} ر.س`;
  return item.description
    ? `${item.name}${price}\n${item.description}`
    : `${item.name}${price}`;
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
          : "text-muted-foreground hover:bg-[var(--brand-soft)]"
      )}
    >
      {children}
    </button>
  );
}
