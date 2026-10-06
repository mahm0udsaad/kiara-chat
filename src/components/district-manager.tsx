"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Ban,
  Check,
  Loader2,
  MapPinPlus,
  Pencil,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { clearDispatchOptionsCache } from "@/lib/dispatch-options-client";
import type { District } from "@/lib/types";
import { Alert, AlertDescription } from "@/components/ui/alert";

const inputClass =
  "min-h-11 w-full rounded-lg border px-3 text-sm outline-none focus:border-[var(--brand)]";

const byName = (a: District, b: District) => a.name.localeCompare(b.name, "ar");

async function request(path: string, init: RequestInit) {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json" },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error ?? "تعذّر حفظ الحي");
  return data;
}

/**
 * The districts an order can name, and what a trip to each costs. Choosing a
 * district on an order copies its fare onto that order, so a correction here
 * applies to the next orders, not to trips already priced.
 */
export function DistrictManager({ initialDistricts }: { initialDistricts: District[] }) {
  const [districts, setDistricts] = useState(() => [...initialDistricts].sort(byName));
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const replace = (next: District) => {
    setDistricts((current) =>
      [...current.filter((item) => item.id !== next.id), next].sort(byName),
    );
    clearDispatchOptionsCache();
  };

  const add = async () => {
    setError(null);
    setNotice(null);
    if (name.trim().length < 2) return setError("اكتبي اسم الحي");
    if (price.trim() === "") return setError("اكتبي تكلفة المشوار");
    setAdding(true);
    try {
      const data = await request("/api/districts", {
        method: "POST",
        body: JSON.stringify({ name, tripPrice: price }),
      });
      replace(data.district as District);
      setName("");
      setPrice("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر إضافة الحي");
    } finally {
      setAdding(false);
    }
  };

  const save = async (
    id: string,
    patch: { name?: string; tripPrice?: string; isActive?: boolean },
  ) => {
    setError(null);
    setNotice(null);
    setBusyId(id);
    try {
      const data = await request(`/api/districts/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      replace(data.district as District);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر حفظ الحي");
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (district: District) => {
    if (!window.confirm(`حذف «${district.name}»؟`)) return;
    setError(null);
    setNotice(null);
    setBusyId(district.id);
    try {
      const data = await request(`/api/districts/${district.id}`, { method: "DELETE" });
      clearDispatchOptionsCache();
      if (data.archived) {
        replace({ ...district, is_active: false });
        setNotice(
          `«${district.name}» مستخدم في طلبات سابقة، فأُوقف بدل حذفه. لن يظهر في الطلبات الجديدة.`,
        );
      } else {
        setDistricts((current) => current.filter((item) => item.id !== district.id));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر حذف الحي");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="dashboard-page max-w-3xl pt-0!">
      <section className="rounded-2xl border bg-[var(--surface)] p-4 sm:p-5">
        <h2 className="font-semibold text-[var(--foreground)]">الأحياء وتكلفة المشاوير</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          عند اختيار الحي في الطلب تُحسب تكلفة المشوار تلقائيًا. تعديل السعر هنا يطبق على
          الطلبات الجديدة فقط.
        </p>

        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="اسم الحي"
            aria-label="اسم الحي"
            maxLength={80}
            className={inputClass}
          />
          <input
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            inputMode="decimal"
            placeholder="تكلفة المشوار (ر.س)"
            aria-label="تكلفة المشوار بالريال"
            className={cn(inputClass, "sm:max-w-44")}
          />
          <button
            type="button"
            onClick={add}
            disabled={adding}
            className="flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[var(--brand)] px-4 text-sm font-medium text-white disabled:opacity-60"
          >
            {adding ? <Loader2 size={15} className="animate-spin" /> : <MapPinPlus size={15} />}
            إضافة
          </button>
        </div>

        {error ? (
          <Alert variant="destructive" className="mb-3">
            <AlertTriangle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {notice ? (
          <Alert className="mb-3">
            <Check />
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}

        {districts.length ? (
          <ul className="divide-y">
            {districts.map((district) => (
              <DistrictRow
                key={district.id}
                district={district}
                busy={busyId === district.id}
                onSave={(patch) => save(district.id, patch)}
                onRemove={() => remove(district)}
              />
            ))}
          </ul>
        ) : (
          <p className="py-4 text-center text-sm text-muted-foreground">لا توجد أحياء بعد.</p>
        )}
      </section>
    </div>
  );
}

function DistrictRow({
  district,
  busy,
  onSave,
  onRemove,
}: {
  district: District;
  busy: boolean;
  onSave: (patch: { name?: string; tripPrice?: string; isActive?: boolean }) => Promise<boolean>;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(district.name);
  const [price, setPrice] = useState(String(district.trip_price ?? ""));

  if (editing) {
    return (
      <li className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label="اسم الحي"
          maxLength={80}
          className={cn(inputClass, "min-h-10 px-2")}
        />
        <input
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          inputMode="decimal"
          aria-label="تكلفة المشوار بالريال"
          className={cn(inputClass, "min-h-10 px-2 sm:max-w-36")}
        />
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            disabled={busy}
            aria-label="حفظ"
            onClick={async () => {
              if (await onSave({ name, tripPrice: price })) setEditing(false);
            }}
            className="flex size-10 items-center justify-center rounded-lg bg-[var(--brand)] text-white disabled:opacity-60"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={16} />}
          </button>
          <button
            type="button"
            aria-label="إلغاء"
            onClick={() => {
              setEditing(false);
              setName(district.name);
              setPrice(String(district.trip_price ?? ""));
            }}
            className="flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-black/5"
          >
            <X size={16} />
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className={cn("flex items-center gap-3 py-2.5", !district.is_active && "opacity-55")}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-[var(--foreground)]">
          {district.name}
          {!district.is_active ? (
            <span className="mr-2 rounded-full bg-black/5 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              موقوف
            </span>
          ) : null}
        </p>
        <p className="text-xs tabular-nums text-muted-foreground">
          {district.trip_price != null ? `${district.trip_price} ر.س للمشوار` : "—"}
        </p>
      </div>
      <div className="flex shrink-0 gap-1">
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`تعديل ${district.name}`}
          className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-black/5"
        >
          <Pencil size={15} />
        </button>
        <button
          type="button"
          onClick={() => onSave({ isActive: !district.is_active })}
          disabled={busy}
          aria-label={district.is_active ? `إيقاف ${district.name}` : `تفعيل ${district.name}`}
          className={cn(
            "flex size-9 items-center justify-center rounded-lg hover:bg-black/5 disabled:opacity-50",
            district.is_active ? "text-amber-600" : "text-emerald-600",
          )}
        >
          {busy ? (
            <Loader2 size={15} className="animate-spin" />
          ) : district.is_active ? (
            <Ban size={15} />
          ) : (
            <RotateCcw size={15} />
          )}
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          aria-label={`حذف ${district.name}`}
          className="flex size-9 items-center justify-center rounded-lg text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </li>
  );
}
