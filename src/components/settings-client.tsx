"use client";

import { useState } from "react";
import { Loader2, Check, Car } from "lucide-react";
import type { DispatchSettings } from "@/lib/types";

/**
 * Dispatch pricing, owner/manager-only. Two prices: a full round trip
 * (ذهاب وعودة) and a one-way / half trip (ذهاب فقط). Every order snapshots the
 * price for its trip type at creation, so editing here never rewrites past
 * orders. Agents never reach this page (admin route guard + RLS).
 */
export function SettingsClient({ initial }: { initial: DispatchSettings }) {
  const [full, setFull] = useState(String(initial.fullTripPrice ?? 0));
  const [half, setHalf] = useState(String(initial.halfTripPrice ?? 0));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/dispatch-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullTripPrice: Number(full),
          halfTripPrice: Number(half),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "تعذّر الحفظ");
        return;
      }
      setFull(String(data.settings.fullTripPrice));
      setHalf(String(data.settings.halfTripPrice));
      setSaved(true);
    } catch {
      setError("تعذّر الحفظ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-6" dir="rtl">
      <div className="mb-5 flex items-center gap-2">
        <Car size={20} className="text-[var(--brand)]" aria-hidden="true" />
        <h1 className="text-lg font-bold text-[var(--foreground)]">
          أسعار التوصيل
        </h1>
      </div>

      <p className="mb-5 text-sm text-[var(--muted)]">
        يُحسب سعر كل طلب حسب نوع الرحلة وقت إنشائه. هذه الأسعار تظهر للمالك
        والمديرين فقط.
      </p>

      <div className="space-y-4 rounded-2xl border bg-[var(--surface)] p-4">
        <PriceInput
          id="full-trip"
          label="سعر الرحلة الكاملة (ذهاب وعودة)"
          value={full}
          onChange={(v) => {
            setFull(v);
            setSaved(false);
          }}
        />
        <PriceInput
          id="half-trip"
          label="سعر نصف الرحلة (ذهاب فقط)"
          value={half}
          onChange={(v) => {
            setHalf(v);
            setSaved(false);
          }}
        />

        {error ? (
          <p className="text-sm text-rose-600">{error}</p>
        ) : null}

        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 font-medium text-white transition-opacity disabled:opacity-60"
        >
          {saving ? (
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          ) : saved ? (
            <Check size={16} aria-hidden="true" />
          ) : null}
          {saved ? "تم الحفظ" : "حفظ الأسعار"}
        </button>
      </div>
    </div>
  );
}

function PriceInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 block text-sm font-medium text-[var(--foreground)]"
      >
        {label}
      </label>
      <div className="flex items-center gap-2 rounded-lg border px-3">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-11 w-full bg-transparent text-sm outline-none tabular-nums"
        />
        <span className="shrink-0 text-sm text-[var(--muted)]">ر.س</span>
      </div>
    </div>
  );
}
