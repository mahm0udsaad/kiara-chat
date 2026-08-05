"use client";

import { Fragment, lazy, Suspense, useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { arSA } from "date-fns/locale";
import {
  CalendarDays,
  Car,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  LayoutList,
  Loader2,
  MapPin,
  MessageCircle,
  RefreshCw,
  Search,
  UserRound,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CustomerTimelineSheet } from "@/components/customer-timeline-sheet";
import { cn } from "@/lib/utils";
import { normalizePhone, phoneMatches } from "@/lib/phone";
import { formatRelativeTime } from "@/lib/format";
import type { ReservationsSnapshot, RekazReservation } from "@/lib/reservations";
import type { BookingRequest, DriverOrderRow } from "@/lib/types";

const CreateOrderSheet = lazy(() =>
  import("@/components/inbox/create-order-sheet").then((m) => ({
    default: m.CreateOrderSheet,
  }))
);

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
const STAMP_FMT = new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TZ,
});
const DAY_KEY_FMT = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: TZ,
});

const STATUS_META: Record<
  string,
  { label: string; variant: "default" | "secondary" | "outline" | "destructive" }
> = {
  Confirmed: { label: "مؤكد", variant: "default" },
  Pending: { label: "غير مؤكد", variant: "secondary" },
  Done: { label: "مكتمل", variant: "outline" },
  Cancelled: { label: "ملغي", variant: "destructive" },
};
const PAYMENT_LABEL: Record<string, string> = {
  Paid: "تم الدفع",
  PartiallyPaid: "مدفوع جزئيًا",
  Pending: "بانتظار الدفع",
};
const ORDER_STATUS_LABEL: Record<string, string> = {
  Confirmed: "مؤكد",
  Pending: "معلّق",
  Cancelled: "ملغي",
};
/** Rekaz's `source`: who put the booking in. */
const SOURCE_LABEL: Record<string, string> = {
  Internal: "الصالون",
  Website: "الموقع",
};

const PAGE_SIZE = 25;

type StatusKey = "all" | "Confirmed" | "Pending" | "Done";

/** One customer's visit: her back-to-back services on one day. */
interface Visit {
  key: string;
  customerName: string;
  customerPhone: string;
  services: RekazReservation[];
  startAt: string;
  endAt: Date;
  location: RekazReservation["location"];
}

/** A customer plus a day — a driver makes one trip for all of it. */
const visitKeyOf = (phone: string, isoAt: string) =>
  `${normalizePhone(phone)}|${DAY_KEY_FMT.format(new Date(isoAt))}`;

/** `YYYY-MM-DD` (Riyadh) → a Date at midday, so the calendar can't drift a day. */
const dateOfKey = (key: string) => new Date(`${key}T12:00:00+03:00`);

/**
 * The visit each row belongs to.
 *
 * The table is one row per reservation, the way Rekaz lists them, but a driver
 * is booked per visit: three services in an afternoon are one trip, and the
 * booking sheet has to be prefilled with the whole span, not one row of it.
 */
function groupVisits(reservations: RekazReservation[]): Map<string, Visit> {
  const byKey = new Map<string, RekazReservation[]>();
  for (const r of reservations) {
    const key = visitKeyOf(r.customerPhone, r.arrivalAt);
    byKey.set(key, [...(byKey.get(key) ?? []), r]);
  }
  const visits = new Map<string, Visit>();
  for (const [key, services] of byKey) {
    services.sort((a, b) => a.arrivalAt.localeCompare(b.arrivalAt));
    const first = services[0];
    const endAt = services.reduce((latest, s) => {
      const end = new Date(new Date(s.arrivalAt).getTime() + s.durationMinutes * 60_000);
      return end > latest ? end : latest;
    }, new Date(first.arrivalAt));
    visits.set(key, {
      key,
      customerName: first.customerName,
      customerPhone: first.customerPhone,
      services,
      startAt: first.arrivalAt,
      endAt,
      location: services.find((s) => s.location)?.location ?? null,
    });
  }
  return visits;
}

const riyal = (value: number) => `${value.toLocaleString("ar-SA")} ر.س`;

/**
 * Kiara's schedule on /orders, as the table the salon already reads on Rekaz.
 *
 * Rekaz is the source of truth: every row here comes from the platform, and
 * nothing on this tab writes back to it. The one column Rekaz doesn't have is
 * إجراءات — طلب سائق hangs a driver order off the customer's WhatsApp thread
 * (created on the spot if she never wrote) and opens the same booking sheet the
 * inbox uses, prefilled from her whole visit.
 *
 * تحديث من ركاز re-pulls on demand. The tab renders the published snapshot
 * rather than calling Rekaz on load, so the platform being slow costs a button
 * press, never the page.
 */
export function RekazReservations({
  snapshot,
  orders,
  todayKey,
}: {
  snapshot: ReservationsSnapshot | null;
  orders: DriverOrderRow[];
  todayKey: string;
}) {
  const router = useRouter();
  const [view, setView] = useState<"table" | "calendar">("table");
  const [statusFilter, setStatusFilter] = useState<StatusKey>("all");
  const [query, setQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedDay, setSelectedDay] = useState(todayKey);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [timelineFor, setTimelineFor] = useState<{
    phone: string;
    name: string;
  } | null>(null);
  const [dispatchFor, setDispatchFor] = useState<{
    visit: Visit;
    conversationId: string;
  } | null>(null);
  const [preparing, setPreparing] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  const reservations = useMemo(
    () =>
      [...(snapshot?.reservations ?? [])].sort((a, b) =>
        a.arrivalAt.localeCompare(b.arrivalAt)
      ),
    [snapshot]
  );
  const visits = useMemo(() => groupVisits(reservations), [reservations]);

  // A visit whose customer already has an order that day shows its state
  // instead of a second button — one driver trip per visit.
  const orderByVisit = useMemo(() => {
    const map = new Map<string, DriverOrderRow>();
    for (const order of orders) {
      const key = visitKeyOf(order.customer_phone, order.arrival_at);
      if (!map.has(key)) map.set(key, order);
    }
    return map;
  }, [orders]);

  const counts = useMemo(() => {
    const c: Record<StatusKey, number> = {
      all: reservations.length,
      Confirmed: 0,
      Pending: 0,
      Done: 0,
    };
    for (const r of reservations) {
      if (r.status in c) c[r.status as StatusKey] += 1;
    }
    return c;
  }, [reservations]);

  // Status + text search — shared by both the table and the calendar. The date
  // range is applied on top for the table only; the calendar IS a date picker.
  const matched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const digits = needle.replace(/\D/g, "");
    return reservations.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!needle) return true;
      // `phoneMatches` normalizes both sides, so a full +966… number, a local
      // 05… one and the last four digits all find the same customer.
      if (digits && phoneMatches(r.customerPhone, needle)) return true;
      if (digits && r.id.includes(digits)) return true;
      return (
        r.customerName.toLowerCase().includes(needle) ||
        r.service.toLowerCase().includes(needle) ||
        r.providers.some((p) => p.toLowerCase().includes(needle))
      );
    });
  }, [reservations, statusFilter, query]);

  const filtered = useMemo(() => {
    if (!dateFrom && !dateTo) return matched;
    return matched.filter((r) => {
      const day = DAY_KEY_FMT.format(new Date(r.arrivalAt));
      if (dateFrom && day < dateFrom) return false;
      if (dateTo && day > dateTo) return false;
      return true;
    });
  }, [matched, dateFrom, dateTo]);

  // A filter that shortens the list must not strand the view on a page that no
  // longer exists.
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const rows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  // Calendar: which days carry reservations (status/search-filtered), and the
  // visits on the day the user picked.
  const bookedDates = useMemo(() => {
    const keys = new Set(matched.map((r) => DAY_KEY_FMT.format(new Date(r.arrivalAt))));
    return [...keys].map(dateOfKey);
  }, [matched]);

  const dayVisits = useMemo(() => {
    const onDay = matched.filter(
      (r) => DAY_KEY_FMT.format(new Date(r.arrivalAt)) === selectedDay
    );
    return [...groupVisits(onDay).values()].sort((a, b) =>
      a.startAt.localeCompare(b.startAt)
    );
  }, [matched, selectedDay]);

  const resetTo = useCallback((change: () => void) => {
    change();
    setPage(0);
    setExpanded(null);
  }, []);

  const openTimeline = useCallback((r: { customerPhone: string; customerName: string }) => {
    setTimelineFor({ phone: r.customerPhone, name: r.customerName });
  }, []);

  /**
   * The customer's WhatsApp thread, started if she has never written.
   *
   * Rekaz knows customers this app has never heard from, so both the driver
   * order and the المحادثة link need a thread to exist before they can point
   * at one.
   */
  const resolveConversation = useCallback(
    async (customer: { customerPhone: string; customerName: string }) => {
      const res = await fetch("/api/reservations/conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: customer.customerPhone,
          name: customer.customerName,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "تعذّر تجهيز المحادثة");
      return data.conversationId as string;
    },
    []
  );

  /** Open the booking sheet on the customer's thread. */
  const requestDriver = useCallback(
    async (visit: Visit) => {
      setError(null);
      setPreparing(visit.key);
      try {
        const conversationId = await resolveConversation(visit);
        setDispatchFor({ visit, conversationId });
      } catch (e) {
        setError(e instanceof Error ? e.message : "تعذّر تجهيز المحادثة");
      } finally {
        setPreparing(null);
      }
    },
    [resolveConversation]
  );

  /** Jump to the inbox with this customer's thread open. */
  const openConversation = useCallback(
    async (r: RekazReservation) => {
      setError(null);
      setOpening(r.id);
      try {
        const conversationId = await resolveConversation(r);
        // Left spinning on purpose — the spinner covers the navigation.
        router.push(`/inbox?c=${conversationId}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "تعذّر فتح المحادثة");
        setOpening(null);
      }
    },
    [resolveConversation, router]
  );

  /** Re-pull the schedule from Rekaz, then re-render from the fresh snapshot. */
  const syncFromRekaz = useCallback(async () => {
    setError(null);
    setSyncNote(null);
    setSyncing(true);
    try {
      const res = await fetch("/api/reservations/sync", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "تعذّر التحديث من ركاز");
        return;
      }
      const named = Number(data.namesFilled) || 0;
      setSyncNote(
        `تم تحديث ${Number(data.reservations ?? 0).toLocaleString("ar-SA")} حجز` +
          (named ? ` · تمّت تسمية ${named.toLocaleString("ar-SA")} محادثة` : "")
      );
      router.refresh();
    } catch {
      setError("تعذّر التحديث من ركاز");
    } finally {
      setSyncing(false);
    }
  }, [router]);

  const syncButton = (
    <Button size="sm" variant="outline" onClick={syncFromRekaz} disabled={syncing}>
      {syncing ? (
        <Loader2 data-icon="inline-start" className="animate-spin" />
      ) : (
        <RefreshCw data-icon="inline-start" />
      )}
      تحديث من ركاز
    </Button>
  );

  if (!snapshot) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UserRound />
          </EmptyMedia>
          <EmptyTitle>لا توجد بيانات من ركاز بعد</EmptyTitle>
          <EmptyDescription>
            اضغطي «تحديث من ركاز» لسحب جدول الحجوزات من المنصة.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          {syncButton}
          {error ? (
            <p aria-live="polite" className="text-sm text-rose-700">
              {error}
            </p>
          ) : null}
        </EmptyContent>
      </Empty>
    );
  }

  const dispatchBooking: BookingRequest | null = dispatchFor
    ? {
        status: "pending",
        summary: dispatchFor.visit.services.map((s) => s.service).join(" + "),
        service: dispatchFor.visit.services.map((s) => s.service).join(" + "),
        time: `${DAY_FMT.format(new Date(dispatchFor.visit.startAt))} · ${TIME_FMT.format(
          new Date(dispatchFor.visit.startAt)
        )} → ${TIME_FMT.format(dispatchFor.visit.endAt)}`,
        location: dispatchFor.visit.location
          ? `${dispatchFor.visit.location.label} — https://maps.google.com/?q=${dispatchFor.visit.location.lat},${dispatchFor.visit.location.lng}`.trim()
          : "",
        at: snapshot.syncedAt,
      }
    : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["all", `الكل ${counts.all.toLocaleString("ar-SA")}`],
              ["Confirmed", `مؤكد ${counts.Confirmed.toLocaleString("ar-SA")}`],
              ["Pending", `غير مؤكد ${counts.Pending.toLocaleString("ar-SA")}`],
              ["Done", `مكتمل ${counts.Done.toLocaleString("ar-SA")}`],
            ] as [StatusKey, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => resetTo(() => setStatusFilter(key))}
              aria-pressed={statusFilter === key}
              className={cn(
                "min-h-9 rounded-full border px-3 text-xs transition-colors",
                statusFilter === key
                  ? "border-[var(--brand)] bg-[var(--brand)] text-white"
                  : "text-muted-foreground hover:bg-[var(--brand-soft)]"
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search
              size={14}
              aria-hidden="true"
              className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => resetTo(() => setQuery(e.target.value))}
              placeholder="اسم، جوال، رقم حجز…"
              aria-label="ابحثي في الحجوزات"
              className="h-9 w-52 ps-8"
            />
          </div>
          <div className="flex rounded-lg border p-0.5" role="group" aria-label="طريقة العرض">
            <button
              type="button"
              onClick={() => setView("table")}
              aria-pressed={view === "table"}
              className={cn(
                "flex min-h-8 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors",
                view === "table"
                  ? "bg-[var(--brand)] text-white"
                  : "text-muted-foreground hover:bg-[var(--brand-soft)]"
              )}
            >
              <LayoutList size={14} aria-hidden="true" />
              جدول
            </button>
            <button
              type="button"
              onClick={() => setView("calendar")}
              aria-pressed={view === "calendar"}
              className={cn(
                "flex min-h-8 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors",
                view === "calendar"
                  ? "bg-[var(--brand)] text-white"
                  : "text-muted-foreground hover:bg-[var(--brand-soft)]"
              )}
            >
              <CalendarDays size={14} aria-hidden="true" />
              تقويم
            </button>
          </div>
          {syncButton}
        </div>
      </div>

      {view === "table" ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">من</span>
          <Input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => resetTo(() => setDateFrom(e.target.value))}
            aria-label="من تاريخ"
            className="h-9 w-40"
          />
          <span className="text-muted-foreground">إلى</span>
          <Input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => resetTo(() => setDateTo(e.target.value))}
            aria-label="إلى تاريخ"
            className="h-9 w-40"
          />
          <button
            type="button"
            onClick={() => resetTo(() => setDateFrom(todayKey))}
            className="min-h-8 rounded-full border px-3 text-muted-foreground transition-colors hover:bg-[var(--brand-soft)]"
          >
            من اليوم
          </button>
          {dateFrom || dateTo ? (
            <button
              type="button"
              onClick={() =>
                resetTo(() => {
                  setDateFrom("");
                  setDateTo("");
                })
              }
              className="flex min-h-8 items-center gap-1 rounded-full border px-3 text-muted-foreground transition-colors hover:bg-[var(--brand-soft)]"
            >
              <X size={12} aria-hidden="true" />
              مسح التاريخ
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {(view === "table" ? filtered : matched).length.toLocaleString("ar-SA")} حجز
          {(view === "table" ? filtered : matched).length !== counts.all
            ? ` من ${counts.all.toLocaleString("ar-SA")}`
            : ""}
        </span>
        <span>آخر تحديث من ركاز {formatRelativeTime(snapshot.syncedAt)}</span>
      </div>

      {error ? (
        <p aria-live="polite" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      {syncNote ? (
        <p aria-live="polite" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {syncNote}
        </p>
      ) : null}

      {view === "calendar" ? (
        <div className="grid items-start gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">تقويم الحجوزات</CardTitle>
            </CardHeader>
            <CardContent>
              <Calendar
                mode="single"
                selected={dateOfKey(selectedDay)}
                onSelect={(date) => {
                  if (date) setSelectedDay(DAY_KEY_FMT.format(date));
                }}
                locale={arSA}
                modifiers={{ booked: bookedDates }}
                modifiersClassNames={{
                  booked: "[&_button]:font-bold [&_button]:ring-1 [&_button]:ring-[var(--brand)]/40",
                }}
                className="mx-auto w-full [--cell-size:2.5rem]"
                captionLayout="dropdown"
              />
              <p className="mt-2 text-center text-xs text-muted-foreground">
                الأيام المميّزة تحتوي حجوزات.
              </p>
            </CardContent>
          </Card>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">
                {DAY_FMT.format(dateOfKey(selectedDay))}
                {selectedDay === todayKey ? (
                  <Badge variant="secondary" className="ms-2">
                    اليوم
                  </Badge>
                ) : null}
              </h3>
              <span className="text-xs text-muted-foreground">
                {dayVisits.length.toLocaleString("ar-SA")} زيارة
              </span>
            </div>
            {dayVisits.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                لا توجد حجوزات في هذا اليوم.
              </p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {dayVisits.map((visit) => (
                  <li key={visit.key}>
                    <VisitCard
                      visit={visit}
                      order={orderByVisit.get(visit.key)}
                      preparing={preparing === visit.key}
                      opening={opening === visit.services[0].id}
                      onRequestDriver={() => requestDriver(visits.get(visit.key) ?? visit)}
                      onOpenConversation={() => openConversation(visit.services[0])}
                      onOpenTimeline={() => openTimeline(visit)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          لا توجد حجوزات مطابقة.
        </p>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>إجراءات</TableHead>
                <TableHead>المحادثة</TableHead>
                <TableHead>الخدمة</TableHead>
                <TableHead>وقت الحجز</TableHead>
                <TableHead>رقم الحجز</TableHead>
                <TableHead>المصدر</TableHead>
                <TableHead>العميل</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>مقدم الخدمة</TableHead>
                <TableHead>الطلب</TableHead>
                <TableHead>تفاصيل</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const arrival = new Date(r.arrivalAt);
                const dayKey = DAY_KEY_FMT.format(arrival);
                const key = visitKeyOf(r.customerPhone, r.arrivalAt);
                const visit = visits.get(key);
                const existing = orderByVisit.get(key);
                const meta = STATUS_META[r.status] ?? {
                  label: r.status || "—",
                  variant: "outline" as const,
                };
                const isOpen = expanded === r.id;
                return (
                  <Fragment key={r.id}>
                    <TableRow className={cn(isOpen && "border-b-0 bg-muted/40")}>
                      <TableCell>
                        {existing ? (
                          <Badge variant="outline" className="gap-1 whitespace-nowrap">
                            <CheckCircle2 size={13} aria-hidden="true" />
                            {existing.status === "sent" ? "سائق مُرسل" : "طلب سائق"}
                          </Badge>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => visit && requestDriver(visit)}
                            disabled={!visit || preparing === key}
                            className="whitespace-nowrap"
                          >
                            {preparing === key ? (
                              <Loader2 data-icon="inline-start" className="animate-spin" />
                            ) : (
                              <Car data-icon="inline-start" />
                            )}
                            طلب سائق
                          </Button>
                        )}
                      </TableCell>

                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openConversation(r)}
                          disabled={opening === r.id}
                          className="whitespace-nowrap"
                        >
                          {opening === r.id ? (
                            <Loader2 data-icon="inline-start" className="animate-spin" />
                          ) : (
                            <MessageCircle data-icon="inline-start" />
                          )}
                          المحادثة
                        </Button>
                      </TableCell>

                      <TableCell className="max-w-[220px]">
                        <span className="block truncate" title={r.service}>
                          {r.service || "—"}
                        </span>
                        {r.quantity > 1 ? (
                          <span className="text-xs text-muted-foreground">
                            ×{r.quantity.toLocaleString("ar-SA")}
                          </span>
                        ) : null}
                      </TableCell>

                      <TableCell className="whitespace-nowrap">
                        <span className="flex items-center gap-1.5">
                          {DAY_FMT.format(arrival)}
                          {dayKey === todayKey ? (
                            <Badge variant="secondary">اليوم</Badge>
                          ) : null}
                        </span>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {TIME_FMT.format(arrival)} ←{" "}
                          {TIME_FMT.format(
                            new Date(arrival.getTime() + r.durationMinutes * 60_000)
                          )}
                        </span>
                      </TableCell>

                      <TableCell className="tabular-nums" dir="ltr">
                        {r.id}
                      </TableCell>

                      <TableCell className="whitespace-nowrap">
                        <Badge variant={r.source === "Website" ? "secondary" : "ghost"}>
                          {SOURCE_LABEL[r.source] ?? r.source ?? "—"}
                        </Badge>
                      </TableCell>

                      <TableCell className="max-w-[170px]">
                        <button
                          type="button"
                          onClick={() => openTimeline(r)}
                          className="block max-w-full text-start"
                          title="عرض سجل العميلة الكامل"
                        >
                          <span className="block truncate font-medium text-[var(--brand)] underline-offset-2 hover:underline">
                            {r.customerName || "بدون اسم"}
                          </span>
                          <span dir="ltr" className="block text-xs text-muted-foreground">
                            {r.customerPhone}
                          </span>
                        </button>
                      </TableCell>

                      <TableCell>
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                      </TableCell>

                      <TableCell className="max-w-[140px]">
                        <span
                          className="block truncate text-xs"
                          title={r.providers.join("، ")}
                        >
                          {r.providers.length ? r.providers.join("، ") : "—"}
                        </span>
                      </TableCell>

                      <TableCell className="whitespace-nowrap">
                        <span className="block text-xs">
                          {PAYMENT_LABEL[r.payment] ?? r.payment ?? "—"}
                        </span>
                        {r.order ? (
                          <span className="block text-xs tabular-nums text-muted-foreground">
                            {riyal(r.order.total)}
                            {r.order.status && r.order.status !== "Confirmed"
                              ? ` · ${ORDER_STATUS_LABEL[r.order.status] ?? r.order.status}`
                              : ""}
                          </span>
                        ) : null}
                      </TableCell>

                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-expanded={isOpen}
                          onClick={() => setExpanded(isOpen ? null : r.id)}
                          className="whitespace-nowrap"
                        >
                          <ChevronDown
                            data-icon="inline-start"
                            className={cn("transition-transform", isOpen && "rotate-180")}
                          />
                          تفاصيل
                        </Button>
                      </TableCell>
                    </TableRow>

                    {isOpen ? (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={11} className="bg-muted/40">
                          <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                            <Detail label="قيمة الخدمة" value={riyal(r.amount)} />
                            <Detail
                              label="المدة"
                              value={`${r.durationMinutes.toLocaleString("ar-SA")} دقيقة`}
                            />
                            <Detail
                              label="أُنشئ بواسطة"
                              value={r.createdBy || (r.source === "Website" ? "الزبونة" : "—")}
                            />
                            <Detail
                              label="تاريخ الإنشاء"
                              value={r.bookedAt ? STAMP_FMT.format(new Date(r.bookedAt)) : "—"}
                            />
                            {visit && visit.services.length > 1 ? (
                              <Detail
                                label="ضمن زيارة"
                                value={`${visit.services.length.toLocaleString("ar-SA")} خدمات · ${TIME_FMT.format(
                                  new Date(visit.startAt)
                                )} ← ${TIME_FMT.format(visit.endAt)}`}
                              />
                            ) : null}
                            {r.notes ? <Detail label="ملاحظات" value={r.notes} /> : null}
                            {r.location ? (
                              <div className="sm:col-span-2">
                                <dt className="text-muted-foreground">الموقع</dt>
                                <dd>
                                  <a
                                    href={`https://maps.google.com/?q=${r.location.lat},${r.location.lng}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 text-[var(--brand)] underline underline-offset-2"
                                  >
                                    <MapPin size={13} aria-hidden="true" />
                                    {r.location.label || "موقع الزبونة"}
                                    <ExternalLink size={11} aria-hidden="true" />
                                  </a>
                                </dd>
                              </div>
                            ) : null}
                          </dl>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {view === "table" && pageCount > 1 ? (
        <div className="flex items-center justify-between gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setPage(safePage - 1);
              setExpanded(null);
            }}
            disabled={safePage === 0}
          >
            السابق
          </Button>
          <span className="text-xs text-muted-foreground">
            صفحة {(safePage + 1).toLocaleString("ar-SA")} من {pageCount.toLocaleString("ar-SA")}
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setPage(safePage + 1);
              setExpanded(null);
            }}
            disabled={safePage >= pageCount - 1}
          >
            التالي
          </Button>
        </div>
      ) : null}

      {dispatchFor ? (
        <Suspense fallback={null}>
          <CreateOrderSheet
            open
            onClose={() => setDispatchFor(null)}
            conversationId={dispatchFor.conversationId}
            booking={dispatchBooking}
            initialArrival={dispatchFor.visit.startAt}
            initialDurationMinutes={Math.round(
              (dispatchFor.visit.endAt.getTime() -
                new Date(dispatchFor.visit.startAt).getTime()) /
                60_000
            )}
            onOrderCreated={() => router.refresh()}
          />
        </Suspense>
      ) : null}

      <CustomerTimelineSheet
        phone={timelineFor?.phone ?? null}
        name={timelineFor?.name ?? null}
        open={Boolean(timelineFor)}
        onClose={() => setTimelineFor(null)}
      />
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

/** A visit in the calendar day-list: the same actions as a table row, boxed. */
function VisitCard({
  visit,
  order,
  preparing,
  opening,
  onRequestDriver,
  onOpenConversation,
  onOpenTimeline,
}: {
  visit: Visit;
  order: DriverOrderRow | undefined;
  preparing: boolean;
  opening: boolean;
  onRequestDriver: () => void;
  onOpenConversation: () => void;
  onOpenTimeline: () => void;
}) {
  const total = visit.services.reduce((sum, s) => sum + s.amount, 0);
  const status = visit.services.some((s) => s.status === "Pending")
    ? "Pending"
    : visit.services.every((s) => s.status === "Done")
      ? "Done"
      : "Confirmed";
  const meta = STATUS_META[status] ?? { label: status, variant: "outline" as const };
  return (
    <Card size="sm" className="h-full">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm tabular-nums">
            {TIME_FMT.format(new Date(visit.startAt))} ← {TIME_FMT.format(visit.endAt)}
          </CardTitle>
          <Badge variant={meta.variant}>{meta.label}</Badge>
        </div>
        <button
          type="button"
          onClick={onOpenTimeline}
          className="text-start text-sm font-medium text-[var(--brand)] underline-offset-2 hover:underline"
        >
          {visit.customerName || "بدون اسم"}
        </button>
        <span dir="ltr" className="block text-xs text-muted-foreground">
          {visit.customerPhone}
        </span>
      </CardHeader>
      <CardContent className="space-y-2">
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {visit.services.map((s) => (
            <li key={s.id} className="truncate">
              {s.service}
            </li>
          ))}
        </ul>
        <Separator />
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {visit.services.length.toLocaleString("ar-SA")} خدمة
          </span>
          <span className="font-medium tabular-nums">
            {total.toLocaleString("ar-SA")} ر.س
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {order ? (
            <Badge variant="outline" className="gap-1">
              <CheckCircle2 size={13} aria-hidden="true" />
              {order.status === "sent" ? "سائق مُرسل" : "طلب سائق"}
            </Badge>
          ) : (
            <Button size="sm" onClick={onRequestDriver} disabled={preparing}>
              {preparing ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : (
                <Car data-icon="inline-start" />
              )}
              طلب سائق
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onOpenConversation} disabled={opening}>
            {opening ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <MessageCircle data-icon="inline-start" />
            )}
            المحادثة
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
