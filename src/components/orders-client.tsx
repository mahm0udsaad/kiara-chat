"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Loader2,
  RefreshCw,
  Send,
  AlertTriangle,
  Clock,
  Car,
  MapPin,
  Phone,
  ExternalLink,
  Wallet,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration, formatRelativeTime, TRIP_TYPE_LABEL } from "@/lib/format";
import type { DriverOrderRow, DriverOrderStatus } from "@/lib/types";

/** Orders are timestamped in KSA wall-clock — the whole operation runs there. */
const TZ = "Asia/Riyadh";

const DAY_FMT = new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: TZ,
});
const TIME_FMT = new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TZ,
});
const MONTH_FMT = new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
  month: "long",
  year: "numeric",
  timeZone: TZ,
});
/** Stable YYYY-MM-DD key in Riyadh time, for grouping and "today". */
const DAY_KEY_FMT = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: TZ,
});

/** Midday avoids any timezone-boundary surprises when re-formatting a key. */
const dateOfKey = (key: string) => new Date(`${key}T12:00:00+03:00`);

/** Sunday-first, matching the Saudi work week. */
const WEEKDAYS = ["أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"];

const STATUS_META: Record<
  DriverOrderStatus,
  { label: string; className: string; Icon: typeof Send }
> = {
  sent: {
    label: "مُرسل",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
    Icon: Send,
  },
  failed: {
    label: "فشل الإرسال",
    className: "bg-rose-50 text-rose-700 border-rose-200",
    Icon: AlertTriangle,
  },
  pending: {
    label: "بالانتظار",
    className: "bg-amber-50 text-amber-700 border-amber-200",
    Icon: Clock,
  },
};

type StatusFilter = "all" | DriverOrderStatus;

const STATUS_FILTERS: [StatusFilter, string][] = [
  ["all", "كل الحالات"],
  ["sent", "مُرسل"],
  ["failed", "فشل"],
  ["pending", "بالانتظار"],
];

type CalendarCell = { day: number; key: string } | null;

/**
 * طلبات اليوم: a month calendar over the dispatch log. Each day carries its
 * order count; picking a day lists that day's orders, where a failed send can
 * be pushed to the driver again. Searching switches to a flat cross-day view —
 * a name lookup shouldn't require knowing the visit date. Visible to employees
 * too (they create the orders) — prices are stripped server-side for them.
 */
export function OrdersClient({
  initialOrders,
  isAdmin,
  todayKey,
}: {
  initialOrders: DriverOrderRow[];
  isAdmin: boolean;
  /** Computed server-side so the first paint needs no client clock. */
  todayKey: string;
}) {
  const [orders, setOrders] = useState(initialOrders);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [driverId, setDriverId] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedDay, setSelectedDay] = useState(todayKey);
  const [cursor, setCursor] = useState(() => ({
    year: Number(todayKey.slice(0, 4)),
    month: Number(todayKey.slice(5, 7)) - 1,
  }));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/orders", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "تعذّر تحديث القائمة");
        return;
      }
      setOrders((data.orders ?? []) as DriverOrderRow[]);
    } catch {
      setError("تعذّر تحديث القائمة");
    } finally {
      setRefreshing(false);
    }
  }, []);

  const replaceOrder = useCallback((next: DriverOrderRow) => {
    setOrders((prev) => prev.map((o) => (o.id === next.id ? next : o)));
  }, []);

  // The driver picker only offers drivers that actually appear in the log.
  const driverOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of orders) {
      if (o.driver_id) map.set(o.driver_id, o.driver_name ?? "سائق محذوف");
    }
    return [...map].sort((a, b) => a[1].localeCompare(b[1], "ar"));
  }, [orders]);

  const matchesFilters = useCallback(
    (o: DriverOrderRow) => {
      if (status !== "all" && o.status !== status) return false;
      if (driverId !== "all" && o.driver_id !== driverId) return false;
      return true;
    },
    [status, driverId]
  );

  // Everything keyed by arrival day — feeds both the grid badges and the
  // selected-day list.
  const ordersByDay = useMemo(() => {
    const map = new Map<string, DriverOrderRow[]>();
    for (const o of orders) {
      const key = DAY_KEY_FMT.format(new Date(o.arrival_at));
      const list = map.get(key);
      if (list) list.push(o);
      else map.set(key, [o]);
    }
    return map;
  }, [orders]);

  const cells = useMemo<CalendarCell[]>(() => {
    // Pure calendar math in UTC: the weekday of a calendar date doesn't
    // depend on the viewer's timezone.
    const offset = new Date(Date.UTC(cursor.year, cursor.month, 1)).getUTCDay();
    const daysInMonth = new Date(
      Date.UTC(cursor.year, cursor.month + 1, 0)
    ).getUTCDate();
    const out: CalendarCell[] = Array.from({ length: offset }, () => null);
    for (let d = 1; d <= daysInMonth; d++) {
      out.push({
        day: d,
        key: `${cursor.year}-${String(cursor.month + 1).padStart(2, "0")}-${String(
          d
        ).padStart(2, "0")}`,
      });
    }
    while (out.length % 7) out.push(null);
    return out;
  }, [cursor]);

  const moveMonth = useCallback((delta: number) => {
    setCursor((c) => {
      const next = new Date(Date.UTC(c.year, c.month + delta, 1));
      return { year: next.getUTCFullYear(), month: next.getUTCMonth() };
    });
  }, []);

  const goToday = useCallback(() => {
    setSelectedDay(todayKey);
    setCursor({
      year: Number(todayKey.slice(0, 4)),
      month: Number(todayKey.slice(5, 7)) - 1,
    });
  }, [todayKey]);

  const searching = query.trim().length > 0;

  // Search mode: one flat, day-grouped list across the whole log.
  const searchGroups = useMemo(() => {
    if (!searching) return [];
    const q = query.trim().toLowerCase();
    const rows = orders.filter((o) => {
      if (!matchesFilters(o)) return false;
      return [
        o.driver_name,
        o.specialist_name,
        o.customer_name,
        o.customer_phone,
        o.driver_phone,
        o.customer_location,
      ]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q));
    });
    const out: { key: string; label: string; rows: DriverOrderRow[] }[] = [];
    for (const o of rows) {
      const date = new Date(o.arrival_at);
      const key = DAY_KEY_FMT.format(date);
      const last = out.at(-1);
      if (last?.key === key) last.rows.push(o);
      else out.push({ key, label: DAY_FMT.format(date), rows: [o] });
    }
    return out;
  }, [searching, query, orders, matchesFilters]);

  // Calendar mode: the selected day's orders, soonest visit first.
  const dayRows = useMemo(() => {
    if (searching) return [];
    return (ordersByDay.get(selectedDay) ?? [])
      .filter(matchesFilters)
      .sort((a, b) => a.arrival_at.localeCompare(b.arrival_at));
  }, [searching, ordersByDay, selectedDay, matchesFilters]);

  const shown = searching ? searchGroups.flatMap((g) => g.rows) : dayRows;

  const stats = useMemo(() => {
    const total = shown.length;
    const sent = shown.filter((o) => o.status === "sent").length;
    const failed = shown.filter((o) => o.status === "failed").length;
    const revenue = shown.reduce((sum, o) => sum + (o.price ?? 0), 0);
    return { total, sent, failed, revenue };
  }, [shown]);

  const selectedLabel =
    selectedDay === todayKey
      ? "طلبات اليوم"
      : DAY_FMT.format(dateOfKey(selectedDay));

  return (
    <div className="dashboard-page max-w-4xl">
      <div className="dashboard-page-header">
        <div>
          <h1>طلبات اليوم</h1>
          <p>
            تقويم الطلبات المرسلة للسائقين. اختاري يومًا لعرض طلباته، والطلب الذي
            فشل إرساله يمكن إعادة إرساله من هنا دون إنشائه من جديد.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border bg-[var(--surface)] px-4 text-sm font-medium text-[var(--muted)] disabled:opacity-60"
        >
          {refreshing ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <RefreshCw size={15} />
          )}
          تحديث
        </button>
      </div>

      <div className="mb-4 space-y-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ابحثي بالسائق أو الأخصائية أو رقم الزبونة أو الموقع…"
          className="min-h-11 w-full rounded-xl border bg-[var(--surface)] px-3 text-sm outline-none focus:border-[var(--brand)]"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_FILTERS.map(([val, label]) => (
            <Chip key={val} active={status === val} onClick={() => setStatus(val)}>
              {label}
            </Chip>
          ))}
          {driverOptions.length > 1 ? (
            <select
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
              aria-label="تصفية بالسائق"
              className="min-h-9 rounded-full border bg-[var(--surface)] px-3 text-xs text-[var(--muted)] outline-none focus:border-[var(--brand)]"
            >
              <option value="all">كل السائقين</option>
              {driverOptions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </div>

      {/* The search box doubles as an escape hatch from the calendar: typing
          anything switches to a flat cross-day view. */}
      {!searching ? (
        <div className="mb-5 rounded-2xl border bg-[var(--surface)] p-3 sm:p-4">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => moveMonth(-1)}
              aria-label="الشهر السابق"
              className="flex size-10 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--brand-soft)]"
            >
              <ChevronRight size={18} aria-hidden="true" />
            </button>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[var(--foreground)]">
                {MONTH_FMT.format(new Date(Date.UTC(cursor.year, cursor.month, 1)))}
              </span>
              {selectedDay !== todayKey ||
              cursor.year !== Number(todayKey.slice(0, 4)) ||
              cursor.month !== Number(todayKey.slice(5, 7)) - 1 ? (
                <button
                  type="button"
                  onClick={goToday}
                  className="rounded-full border px-2.5 py-1 text-[11px] font-medium text-[var(--brand)] hover:bg-[var(--brand-soft)]"
                >
                  اليوم
                </button>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => moveMonth(1)}
              aria-label="الشهر التالي"
              className="flex size-10 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--brand-soft)]"
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAYS.map((w) => (
              <div
                key={w}
                className="pb-1 text-[10px] font-medium text-[var(--subtle)]"
              >
                {w}
              </div>
            ))}
            {cells.map((cell, i) => {
              if (!cell) return <div key={`empty-${i}`} aria-hidden="true" />;
              const dayOrders = ordersByDay.get(cell.key) ?? [];
              const isSelected = selectedDay === cell.key;
              const isToday = cell.key === todayKey;
              const hasFailed = dayOrders.some((o) => o.status === "failed");
              return (
                <button
                  key={cell.key}
                  type="button"
                  onClick={() => setSelectedDay(cell.key)}
                  aria-pressed={isSelected}
                  aria-label={`${DAY_FMT.format(dateOfKey(cell.key))} — ${
                    dayOrders.length
                  } طلب`}
                  className={cn(
                    "flex min-h-12 flex-col items-center justify-center rounded-lg border text-sm tabular-nums transition-colors",
                    isSelected
                      ? "border-[var(--brand)] bg-[var(--brand)] text-white"
                      : isToday
                        ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)] font-semibold"
                        : "border-transparent text-[var(--foreground)] hover:bg-[var(--brand-soft)]"
                  )}
                >
                  {cell.day.toLocaleString("ar")}
                  {dayOrders.length ? (
                    <span
                      className={cn(
                        "mt-0.5 min-w-4 rounded-full px-1 text-[9px] font-semibold leading-4",
                        isSelected
                          ? "bg-white/25 text-white"
                          : hasFailed
                            ? "bg-rose-100 text-rose-700"
                            : "bg-[var(--brand-soft)] text-[var(--brand)]"
                      )}
                    >
                      {dayOrders.length.toLocaleString("ar")}
                    </span>
                  ) : (
                    <span className="mt-0.5 leading-4 text-transparent text-[9px]">
                      ·
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div
        className={cn(
          "mb-5 grid grid-cols-3 gap-2",
          isAdmin && "grid-cols-2 sm:grid-cols-4"
        )}
      >
        <Stat icon={<Car size={14} aria-hidden="true" />} label="طلبات" value={stats.total} />
        <Stat
          icon={<Send size={14} aria-hidden="true" />}
          label="مُرسلة"
          value={stats.sent}
          tone="good"
        />
        <Stat
          icon={<AlertTriangle size={14} aria-hidden="true" />}
          label="فشل إرسالها"
          value={stats.failed}
          tone={stats.failed ? "warn" : "default"}
        />
        {isAdmin ? (
          <Stat
            icon={<Wallet size={14} aria-hidden="true" />}
            label="إجمالي الأجرة"
            value={stats.revenue}
            suffix=" ر.س"
          />
        ) : null}
      </div>

      {error ? (
        <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      ) : null}

      {searching ? (
        searchGroups.length ? (
          <div className="space-y-5">
            {searchGroups.map((group) => (
              <section key={group.key}>
                <h2 className="mb-2 text-xs font-semibold text-[var(--muted)]">
                  {group.label}
                </h2>
                <ul className="space-y-2">
                  {group.rows.map((order) => (
                    <OrderCard
                      key={order.id}
                      order={order}
                      isAdmin={isAdmin}
                      onUpdated={replaceOrder}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <EmptyState text="لا طلبات مطابقة للبحث." />
        )
      ) : (
        <section>
          <h2 className="mb-2 text-xs font-semibold text-[var(--muted)]">
            {selectedLabel}
          </h2>
          {dayRows.length ? (
            <ul className="space-y-2">
              {dayRows.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  isAdmin={isAdmin}
                  onUpdated={replaceOrder}
                />
              ))}
            </ul>
          ) : (
            <EmptyState
              text={
                orders.length
                  ? "لا توجد طلبات في هذا اليوم."
                  : "لا توجد طلبات بعد. تُنشأ من زر «طلب سائق» داخل المحادثة."
              }
            />
          )}
        </section>
      )}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed bg-[var(--surface)] p-8 text-center">
      <Car size={22} className="mx-auto mb-2 text-[var(--subtle)]" aria-hidden="true" />
      <p className="text-sm text-[var(--muted)]">{text}</p>
    </div>
  );
}

function OrderCard({
  order,
  isAdmin,
  onUpdated,
}: {
  order: DriverOrderRow;
  isAdmin: boolean;
  onUpdated: (next: DriverOrderRow) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const { label: statusLabel, className: statusClass, Icon: StatusIcon } =
    STATUS_META[order.status];
  const arrival = new Date(order.arrival_at);
  const isLink = /^https?:\/\//i.test(order.customer_location.trim());

  const resend = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/orders/${order.id}/resend`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNote({ ok: false, text: data?.error ?? "تعذّرت إعادة الإرسال" });
        return;
      }
      onUpdated(data.order as DriverOrderRow);
      setNote(
        data.sent
          ? { ok: true, text: "تم إرسال الطلب للسائق مرة أخرى." }
          : { ok: false, text: "لم يصل الطلب للسائق. تحققي من ربط واتساب ثم أعيدي المحاولة." }
      );
    } catch {
      setNote({ ok: false, text: "تعذّرت إعادة الإرسال" });
    } finally {
      setBusy(false);
    }
  }, [order.id, onUpdated]);

  return (
    <li className="rounded-2xl border bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-[var(--foreground)]">
            <span className="tabular-nums">{TIME_FMT.format(arrival)}</span>
            <span className="text-[var(--muted)]"> · </span>
            {order.specialist_name ?? "أخصائية محذوفة"}
          </p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            {formatDuration(order.duration_minutes)} · {TRIP_TYPE_LABEL[order.trip_type]}
            {isAdmin && order.price != null && order.price > 0
              ? ` · ${order.price.toLocaleString("ar-SA")} ر.س`
              : ""}
          </p>
        </div>
        <span
          className={cn(
            "flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
            statusClass
          )}
        >
          <StatusIcon size={11} aria-hidden="true" />
          {statusLabel}
        </span>
      </div>

      <dl className="mt-3 space-y-1.5 text-sm">
        <Row icon={<Car size={13} aria-hidden="true" />} label="السائق">
          {order.driver_name ?? "سائق محذوف"}
          {order.driver_phone ? (
            <>
              {" · "}
              <span dir="ltr" className="text-xs text-[var(--muted)]">
                {order.driver_phone}
              </span>
            </>
          ) : null}
        </Row>
        <Row icon={<Phone size={13} aria-hidden="true" />} label="الزبونة">
          {order.customer_name ? `${order.customer_name} · ` : ""}
          <span dir="ltr">{order.customer_phone}</span>
        </Row>
        <Row icon={<MapPin size={13} aria-hidden="true" />} label="الموقع">
          {isLink ? (
            <a
              href={order.customer_location.trim()}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[var(--brand)] underline underline-offset-2"
            >
              فتح الموقع <ExternalLink size={11} aria-hidden="true" />
            </a>
          ) : (
            <span className="break-words">{order.customer_location}</span>
          )}
        </Row>
      </dl>

      {note ? (
        <p
          className={cn(
            "mt-3 rounded-lg px-3 py-2 text-xs",
            note.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
          )}
        >
          {note.text}
        </p>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3">
        <span className="text-[11px] text-[var(--subtle)]">
          أُنشئ {formatRelativeTime(order.created_at)}
          {order.sent_at ? ` · أُرسل ${formatRelativeTime(order.sent_at)}` : ""}
        </span>
        <button
          type="button"
          onClick={resend}
          disabled={busy || !order.driver_id}
          className={cn(
            "flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-medium disabled:opacity-50",
            order.status === "sent"
              ? "border text-[var(--muted)]"
              : "bg-[var(--brand)] text-white"
          )}
        >
          {busy ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Send size={13} aria-hidden="true" />
          )}
          إعادة الإرسال
        </button>
      </div>
    </li>
  );
}

function Row({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <dt className="flex shrink-0 items-center gap-1 text-xs text-[var(--muted)]">
        {icon}
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-[var(--foreground)]">{children}</dd>
    </div>
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
        "min-h-9 rounded-full border px-3 text-xs transition-colors",
        active
          ? "border-[var(--brand)] bg-[var(--brand)] text-white"
          : "bg-[var(--surface)] text-[var(--muted)] hover:bg-[var(--brand-soft)]"
      )}
    >
      {children}
    </button>
  );
}

function Stat({
  icon,
  label,
  value,
  tone = "default",
  suffix = "",
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: "default" | "warn" | "good";
  suffix?: string;
}) {
  return (
    <div className="rounded-xl border bg-[var(--surface)] p-3">
      <div className="flex items-center gap-1.5 text-[var(--muted)]">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p
        className={cn(
          "mt-1 text-xl font-semibold tabular-nums sm:text-2xl",
          tone === "warn" && "text-amber-600",
          tone === "good" && "text-emerald-600",
          tone === "default" && "text-[var(--foreground)]"
        )}
      >
        {value.toLocaleString("ar")}
        {suffix ? <span className="text-sm font-normal">{suffix}</span> : null}
      </p>
    </div>
  );
}
