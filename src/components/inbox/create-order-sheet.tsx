"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, MapPin, Check } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import type { Specialist, Driver } from "@/lib/types";

const DURATION_PRESETS = [30, 45, 60, 90, 120];

/** Local Date → the value a datetime-local input expects (no timezone shift). */
function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export function CreateOrderSheet({
  open,
  onClose,
  conversationId,
  customerPhone,
  customerName,
  isAdmin,
  suggestedLocation,
}: {
  open: boolean;
  onClose: () => void;
  conversationId: string;
  customerPhone: string;
  customerName: string | null;
  isAdmin: boolean;
  /** Last customer message — offered as a one-tap fill for the location field. */
  suggestedLocation: string | null;
}) {
  const [specialists, setSpecialists] = useState<Specialist[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [rostersLoading, setRostersLoading] = useState(false);

  const [specialistId, setSpecialistId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [arrival, setArrival] = useState("");
  const [location, setLocation] = useState("");
  const [duration, setDuration] = useState(60);
  const [customDuration, setCustomDuration] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"sent" | "failed" | null>(null);

  // Reset + prefill each time the sheet opens.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setDone(null);
    setLocation("");
    setDuration(60);
    setCustomDuration(false);
    // Default arrival: one hour from now, rounded to the next 5 minutes.
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
    setArrival(toLocalInputValue(d));
  }, [open]);

  const loadRosters = useCallback(async () => {
    setRostersLoading(true);
    try {
      const [sRes, dRes] = await Promise.all([
        fetch("/api/specialists"),
        fetch("/api/drivers"),
      ]);
      const sData = await sRes.json();
      const dData = await dRes.json();
      const activeS = ((sData.specialists ?? []) as Specialist[]).filter((s) => s.is_active);
      const activeD = ((dData.drivers ?? []) as Driver[]).filter((d) => d.is_active);
      setSpecialists(activeS);
      setDrivers(activeD);
      setSpecialistId((prev) => prev || activeS[0]?.id || "");
      setDriverId((prev) => prev || activeD[0]?.id || "");
    } catch {
      setError("تعذّر تحميل القوائم");
    } finally {
      setRostersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void loadRosters();
  }, [open, loadRosters]);

  const submit = useCallback(async () => {
    setError(null);
    if (!specialistId) return setError("اختاري الأخصائية");
    if (!driverId) return setError("اختاري السائق");
    if (!arrival) return setError("حددي موعد الوصول");
    if (!location.trim()) return setError("موقع الزبونة مطلوب");

    setSubmitting(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          specialistId,
          driverId,
          // Convert the local wall-clock to an absolute instant (ISO + offset).
          arrivalAt: new Date(arrival).toISOString(),
          customerLocation: location.trim(),
          durationMinutes: duration,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "تعذّر إنشاء الطلب");
        return;
      }
      setDone(data?.sent ? "sent" : "failed");
    } catch {
      setError("تعذّر إنشاء الطلب");
    } finally {
      setSubmitting(false);
    }
  }, [specialistId, driverId, arrival, location, duration, conversationId]);

  const canSuggest = useMemo(
    () => Boolean(suggestedLocation && suggestedLocation.trim()),
    [suggestedLocation]
  );

  return (
    <Modal open={open} onClose={onClose} title="إنشاء طلب للسائق">
      {done ? (
        <div className="space-y-4 py-4 text-center">
          <div
            className={cn(
              "mx-auto flex size-12 items-center justify-center rounded-full",
              done === "sent" ? "bg-emerald-100 text-emerald-600" : "bg-amber-100 text-amber-600"
            )}
          >
            <Check size={24} />
          </div>
          <p className="font-semibold text-[var(--foreground)]">
            {done === "sent" ? "تم إرسال الطلب للسائق ✅" : "تم حفظ الطلب"}
          </p>
          {done === "failed" ? (
            <p className="text-sm text-[var(--muted)]">
              تعذّر إرسال رسالة واتساب للسائق. الطلب محفوظ ويمكن إعادة إرساله لاحقًا.
            </p>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 w-full rounded-xl bg-[var(--brand)] px-4 font-medium text-white"
          >
            تم
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {rostersLoading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-[var(--muted)]">
              <Loader2 size={14} className="animate-spin" /> جارٍ التحميل…
            </div>
          ) : (
            <>
              <RosterField
                label="الأخصائية"
                items={specialists}
                value={specialistId}
                onChange={setSpecialistId}
                emptyHint="لا توجد أخصائيات."
                isAdmin={isAdmin}
                kind="specialist"
                onAdded={(s) => {
                  setSpecialists((p) => [...p, s as Specialist]);
                  setSpecialistId((s as Specialist).id);
                }}
              />

              <RosterField
                label="السائق"
                items={drivers}
                value={driverId}
                onChange={setDriverId}
                emptyHint="لا يوجد سائقون."
                isAdmin={isAdmin}
                kind="driver"
                onAdded={(d) => {
                  setDrivers((p) => [...p, d as Driver]);
                  setDriverId((d as Driver).id);
                }}
              />

              <label className="block space-y-1">
                <span className="text-sm font-medium text-[var(--foreground)]">موعد الوصول</span>
                <input
                  type="datetime-local"
                  value={arrival}
                  onChange={(e) => setArrival(e.target.value)}
                  className="min-h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-[var(--brand)]"
                />
              </label>

              <div className="space-y-1">
                <span className="text-sm font-medium text-[var(--foreground)]">مدة الجلسة</span>
                <div className="flex flex-wrap gap-1.5">
                  {DURATION_PRESETS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setCustomDuration(false);
                        setDuration(m);
                      }}
                      aria-pressed={!customDuration && duration === m}
                      className={cn(
                        "min-h-9 rounded-full border px-3 text-xs transition-colors",
                        !customDuration && duration === m
                          ? "border-[var(--brand)] bg-[var(--brand)] text-white"
                          : "text-[var(--muted)] hover:bg-[var(--brand-soft)]"
                      )}
                    >
                      {m} د
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setCustomDuration(true)}
                    aria-pressed={customDuration}
                    className={cn(
                      "min-h-9 rounded-full border px-3 text-xs transition-colors",
                      customDuration
                        ? "border-[var(--brand)] bg-[var(--brand)] text-white"
                        : "text-[var(--muted)] hover:bg-[var(--brand-soft)]"
                    )}
                  >
                    أخرى
                  </button>
                </div>
                {customDuration ? (
                  <input
                    type="number"
                    min={5}
                    step={5}
                    value={duration}
                    onChange={(e) => setDuration(Math.max(5, Number(e.target.value) || 0))}
                    aria-label="مدة مخصصة بالدقائق"
                    className="mt-1 min-h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-[var(--brand)]"
                    placeholder="عدد الدقائق"
                  />
                ) : null}
              </div>

              <label className="block space-y-1">
                <span className="text-sm font-medium text-[var(--foreground)]">موقع الزبونة</span>
                <textarea
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  rows={2}
                  placeholder="رابط الموقع من الخرائط أو العنوان"
                  className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-[var(--brand)]"
                />
                {canSuggest ? (
                  <button
                    type="button"
                    onClick={() => setLocation(suggestedLocation!.trim())}
                    className="inline-flex items-center gap-1 rounded-lg bg-[var(--brand-soft)] px-2 py-1 text-xs text-[var(--brand)]"
                  >
                    <MapPin size={12} /> من المحادثة
                    <span className="max-w-[12rem] truncate opacity-70">
                      {suggestedLocation}
                    </span>
                  </button>
                ) : null}
              </label>

              <div className="rounded-xl bg-black/[0.03] px-3 py-2 text-sm">
                <span className="text-[var(--muted)]">رقم الزبونة: </span>
                <span dir="ltr" className="font-medium text-[var(--foreground)]">
                  {customerPhone}
                </span>
                {customerName ? (
                  <span className="text-[var(--muted)]"> · {customerName}</span>
                ) : null}
              </div>

              {error ? (
                <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
              ) : null}

              <button
                type="button"
                onClick={submit}
                disabled={submitting}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 font-medium text-white disabled:opacity-60"
              >
                {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
                إرسال الطلب للسائق
              </button>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

/** A picker with an admin-only inline "add new" form. */
function RosterField<T extends Specialist | Driver>({
  label,
  items,
  value,
  onChange,
  emptyHint,
  isAdmin,
  kind,
  onAdded,
}: {
  label: string;
  items: T[];
  value: string;
  onChange: (id: string) => void;
  emptyHint: string;
  isAdmin: boolean;
  kind: "specialist" | "driver";
  onAdded: (item: Specialist | Driver) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const add = useCallback(async () => {
    setErr(null);
    if (!name.trim()) return setErr("الاسم مطلوب");
    if (kind === "driver" && !phone.trim()) return setErr("رقم السائق مطلوب");
    setBusy(true);
    try {
      const res = await fetch(kind === "driver" ? "/api/drivers" : "/api/specialists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: name.trim(), phone: phone.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data?.error ?? "تعذّرت الإضافة");
        return;
      }
      onAdded(kind === "driver" ? data.driver : data.specialist);
      setName("");
      setPhone("");
      setAdding(false);
    } catch {
      setErr("تعذّرت الإضافة");
    } finally {
      setBusy(false);
    }
  }, [name, phone, kind, onAdded]);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-[var(--foreground)]">{label}</span>
        {isAdmin ? (
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="inline-flex items-center gap-1 text-xs text-[var(--brand)]"
          >
            <Plus size={12} /> إضافة
          </button>
        ) : null}
      </div>

      {items.length ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-[var(--brand)]"
        >
          {items.map((it) => (
            <option key={it.id} value={it.id}>
              {it.full_name}
            </option>
          ))}
        </select>
      ) : (
        <p className="text-xs text-[var(--muted)]">{emptyHint}</p>
      )}

      {adding ? (
        <div className="space-y-1.5 rounded-xl border border-dashed p-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="الاسم"
            className="min-h-10 w-full rounded-lg border px-2 text-sm outline-none focus:border-[var(--brand)]"
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            dir="ltr"
            placeholder={kind === "driver" ? "رقم واتساب (‎+9665…)" : "رقم (اختياري)"}
            className="min-h-10 w-full rounded-lg border px-2 text-sm outline-none focus:border-[var(--brand)]"
          />
          {err ? <p className="text-xs text-rose-600">{err}</p> : null}
          <button
            type="button"
            onClick={add}
            disabled={busy}
            className="flex min-h-9 w-full items-center justify-center gap-1 rounded-lg bg-[var(--brand)] text-sm text-white disabled:opacity-60"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : null} حفظ
          </button>
        </div>
      ) : null}
    </div>
  );
}
