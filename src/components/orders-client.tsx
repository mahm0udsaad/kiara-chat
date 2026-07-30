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
/** Stable YYYY-MM-DD key in Riyadh time, for grouping and "today". */
const DAY_KEY_FMT = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: TZ,
});

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
type ScopeFilter = "all" | "upcoming" | "today";

const STATUS_FILTERS: [StatusFilter, string][] = [
  ["all", "كل الحالات"],
  ["sent", "مُرسل"],
  ["failed", "فشل"],
  ["pending", "بالانتظار"],
];

const SCOPE_FILTERS: [ScopeFilter, string][] = [
  ["all", "الكل"],
  ["upcoming", "القادمة"],
  ["today", "اليوم"],
];

/**
 * The dispatch log: every order that was pushed to a driver, with the recovery
 * action for a send that failed. Visible to employees too (they create the
 * orders) — prices are stripped server-side for them.
 */
export function OrdersClient({
  initialOrders,
  isAdmin,
}: {
  initialOrders: DriverOrderRow[];
  isAdmin: boolean;
}) {
  const [orders, setOrders] = useState(initialOrders);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [driverId, setDriverId] = useState("all");
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Sampled in event handlers, never during render: the "القادمة"/"اليوم" scopes
  // need a clock, but reading one while rendering makes the output unstable.
  const [now, setNow] = useState(0);

  const pickScope = useCallback((next: ScopeFilter) => {
    setScope(next);
    setNow(Date.now());
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    setNow(Date.now());
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

  const filtered = useMemo(() => {
    const todayKey = now ? DAY_KEY_FMT.format(new Date(now)) : null;
    const q = query.trim().toLowerCase();

    const rows = orders.filter((o) => {
      if (status !== "all" && o.status !== status) return false;
      if (driverId !== "all" && o.driver_id !== driverId) return false;
      // `now` is 0 until the clock effect runs; the time-based scopes only kick
      // in once we have a real timestamp (they're not the default view).
      if (scope === "upcoming" && now && new Date(o.arrival_at).getTime() < now)
        return false;
      if (scope === "today" && todayKey && DAY_KEY_FMT.format(new Date(o.arrival_at)) !== todayKey)
        return false;
      if (!q) return true;
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

    // Upcoming reads best soonest-first; history newest-first.
    return scope === "upcoming"
      ? [...rows].sort((a, b) => a.arrival_at.localeCompare(b.arrival_at))
      : rows;
  }, [orders, status, scope, driverId, query, now]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const sent = filtered.filter((o) => o.status === "sent").length;
    const failed = filtered.filter((o) => o.status === "failed").length;
    const revenue = filtered.reduce((sum, o) => sum + (o.price ?? 0), 0);
    return { total, sent, failed, revenue };
  }, [filtered]);

  // Group by arrival day so a long log stays scannable.
  const groups = useMemo(() => {
    const out: { key: string; label: string; rows: DriverOrderRow[] }[] = [];
    for (const o of filtered) {
      const date = new Date(o.arrival_at);
      const key = DAY_KEY_FMT.format(date);
      const last = out.at(-1);
      if (last?.key === key) last.rows.push(o);
      else out.push({ key, label: DAY_FMT.format(date), rows: [o] });
    }
    return out;
  }, [filtered]);

  return (
    <div className="dashboard-page max-w-4xl">
      <div className="dashboard-page-header">
        <div>
          <h1>طلبات السائقين</h1>
          <p>
            كل طلب أُرسل لسائق من صفحة المحادثات. الطلب الذي فشل إرساله يمكن إعادة
            إرساله من هنا دون إنشائه من جديد.
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

      <div className="mb-4 space-y-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ابحثي بالسائق أو الأخصائية أو رقم الزبونة أو الموقع…"
          className="min-h-11 w-full rounded-xl border bg-[var(--surface)] px-3 text-sm outline-none focus:border-[var(--brand)]"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          {SCOPE_FILTERS.map(([val, label]) => (
            <Chip key={val} active={scope === val} onClick={() => pickScope(val)}>
              {label}
            </Chip>
          ))}
          <span className="mx-1 h-5 w-px bg-[var(--line)]" aria-hidden="true" />
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

      {error ? (
        <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      ) : null}

      {groups.length ? (
        <div className="space-y-5">
          {groups.map((group) => (
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
        <div className="rounded-2xl border border-dashed bg-[var(--surface)] p-8 text-center">
          <Car size={22} className="mx-auto mb-2 text-[var(--subtle)]" aria-hidden="true" />
          <p className="text-sm text-[var(--muted)]">
            {orders.length
              ? "لا طلبات مطابقة للتصفية."
              : "لا توجد طلبات بعد. تُنشأ من زر «طلب سائق» داخل المحادثة."}
          </p>
        </div>
      )}
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
