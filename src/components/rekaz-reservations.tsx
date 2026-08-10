"use client";

import { Fragment, lazy, Suspense, useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Bell,
  CalendarDays,
  Car,
  Check,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  LayoutList,
  Loader2,
  MapPin,
  MessageCircle,
  RefreshCw,
  Search,
  SquarePen,
  UserRound,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { normalizePhone, phoneMatches } from "@/lib/phone";
import { formatRelativeTime } from "@/lib/format";
import type { ReservationsSnapshot, RekazReservation } from "@/lib/reservations";
import {
  MAX_RESERVATION_REMINDER_LENGTH,
  RESERVATION_FOLLOW_UP_LABEL,
  reservationDayKey,
  reservationReminderMessage,
  type ReservationFollowUp,
  type ReservationFollowUpMap,
  type ReservationFollowUpStatus,
} from "@/lib/reservation-follow-up";
import type { DriverOrderRow } from "@/lib/types";

const ArabicCalendar = lazy(() =>
  import("@/components/arabic-calendar").then((module) => ({
    default: module.ArabicCalendar,
  }))
);
const DispatchDialog = lazy(() =>
  import("@/components/dispatch-dialog").then((module) => ({
    default: module.DispatchDialog,
  }))
);
const CustomerTimelineSheet = lazy(() =>
  import("@/components/customer-timeline-sheet").then((module) => ({
    default: module.CustomerTimelineSheet,
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
/** Rekaz's `source`: who put the booking in. */
const SOURCE_LABEL: Record<string, string> = {
  Internal: "الصالون",
  Website: "الموقع",
  Test: "تجريبي",
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

function reservationIssues(reservation: RekazReservation): string[] {
  const issues: string[] = [];
  if (reservation.status === "Pending") issues.push("الحجز غير مؤكد");
  if (reservation.customerPhone.replace(/\D/g, "").length < 10) {
    issues.push("رقم العميلة ناقص");
  }
  if (!reservation.location) issues.push("الموقع غير مسجل");
  if (!reservation.providers.length) issues.push("الأخصائية غير محددة");
  return issues;
}

function visitStatus(visit: Visit): string {
  if (visit.services.some((service) => service.status === "Pending")) {
    return "Pending";
  }
  if (visit.services.every((service) => service.status === "Done")) {
    return "Done";
  }
  if (visit.services.every((service) => service.status === "Cancelled")) {
    return "Cancelled";
  }
  return "Confirmed";
}

function visitIssues(visit: Visit): string[] {
  return [
    ...new Set(visit.services.flatMap((service) => reservationIssues(service))),
  ];
}

function visitProviders(visit: Visit): string[] {
  return [...new Set(visit.services.flatMap((service) => service.providers))];
}

/**
 * The visit each row belongs to.
 *
 * Rekaz lists one row per service, but Kiara operates on the whole visit: three
 * services in an afternoon are one customer arrival, one follow-up, and one
 * driver trip. The table and calendar therefore share this grouped read model.
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
 * (created on the spot if she never wrote), fills it directly from her Rekaz
 * visit, and opens one confirmation dialog for the specialist and driver.
 *
 * تحديث من ركاز re-pulls on demand. The tab renders the published snapshot
 * rather than calling Rekaz on load, so the platform being slow costs a button
 * press, never the page.
 */
export function RekazReservations({
  snapshot,
  orders,
  todayKey,
  initialFollowUps,
}: {
  snapshot: ReservationsSnapshot | null;
  orders: DriverOrderRow[];
  todayKey: string;
  initialFollowUps: ReservationFollowUpMap;
}) {
  const router = useRouter();
  const [view, setView] = useState<"table" | "calendar">("table");
  const [statusFilter, setStatusFilter] = useState<StatusKey>("all");
  const [query, setQuery] = useState("");
  const [dateFrom, setDateFrom] = useState(todayKey);
  const [dateTo, setDateTo] = useState(todayKey);
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [selectedDay, setSelectedDay] = useState(todayKey);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [timelineFor, setTimelineFor] = useState<{
    phone: string;
    name: string;
  } | null>(null);
  const [dispatchOrder, setDispatchOrder] = useState<{
    order: DriverOrderRow;
    specialistName: string | null;
  } | null>(null);
  const [preparing, setPreparing] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [reminding, setReminding] = useState<string | null>(null);
  const [reminderFor, setReminderFor] = useState<Visit | null>(null);
  const [reminderMessage, setReminderMessage] = useState("");
  const [reminderError, setReminderError] = useState<string | null>(null);
  const [followUpBusy, setFollowUpBusy] = useState<string | null>(null);
  const [followUpOverrides, setFollowUpOverrides] = useState<ReservationFollowUpMap>({});
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
  const allVisits = useMemo(() => [...visits.values()], [visits]);
  const followUps = useMemo(
    () => ({ ...initialFollowUps, ...followUpOverrides }),
    [followUpOverrides, initialFollowUps]
  );

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
      all: allVisits.length,
      Confirmed: 0,
      Pending: 0,
      Done: 0,
    };
    for (const visit of allVisits) {
      const status = visitStatus(visit);
      if (status in c) c[status as StatusKey] += 1;
    }
    return c;
  }, [allVisits]);

  // Status + text search — shared by both the table and the calendar. The date
  // range is applied on top for the table only; the calendar IS a date picker.
  const matched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const digits = needle.replace(/\D/g, "");
    return allVisits.filter((visit) => {
      if (statusFilter !== "all" && visitStatus(visit) !== statusFilter) {
        return false;
      }
      if (attentionOnly && visitIssues(visit).length === 0) return false;
      if (!needle) return true;
      // `phoneMatches` normalizes both sides, so a full +966… number, a local
      // 05… one and the last four digits all find the same customer.
      if (digits && phoneMatches(visit.customerPhone, needle)) return true;
      if (digits && visit.services.some((service) => service.id.includes(digits))) {
        return true;
      }
      return (
        visit.customerName.toLowerCase().includes(needle) ||
        visit.services.some((service) =>
          service.service.toLowerCase().includes(needle)
        ) ||
        visitProviders(visit).some((provider) =>
          provider.toLowerCase().includes(needle)
        )
      );
    });
  }, [allVisits, attentionOnly, statusFilter, query]);

  const attentionCount = useMemo(
    () => allVisits.filter((visit) => visitIssues(visit).length > 0).length,
    [allVisits]
  );

  const filtered = useMemo(() => {
    if (!dateFrom && !dateTo) return matched;
    return matched.filter((visit) => {
      const day = DAY_KEY_FMT.format(new Date(visit.startAt));
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
    const keys = new Set(
      matched.map((visit) => DAY_KEY_FMT.format(new Date(visit.startAt)))
    );
    return [...keys].map(dateOfKey);
  }, [matched]);

  const dayVisits = useMemo(() => {
    return matched.filter(
      (visit) => DAY_KEY_FMT.format(new Date(visit.startAt)) === selectedDay
    );
  }, [matched, selectedDay]);

  const visibleVisits = view === "table" ? filtered : matched;
  const visibleServiceCount = visibleVisits.reduce(
    (total, visit) => total + visit.services.length,
    0
  );

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

  /** Create the dispatch record silently from Rekaz, then choose its recipients. */
  const requestDriver = useCallback(
    async (visit: Visit) => {
      setError(null);
      if (followUps[visit.key]?.status === "cancelled") {
        setError("لا يمكن طلب سائق لزيارة ألغتها العميلة");
        return;
      }
      if (!visit.location) {
        setError("لا يوجد موقع للعميلة في حجز ركاز. أضيفي الموقع في ركاز ثم حدّثي الحجوزات.");
        return;
      }
      setPreparing(visit.key);
      try {
        const conversationId = await resolveConversation(visit);
        const customerLocation = [
          visit.location.label,
          `https://maps.google.com/?q=${visit.location.lat},${visit.location.lng}`,
        ]
          .filter(Boolean)
          .join(" — ");
        const response = await fetch(`/api/conversations/${conversationId}/orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            arrivalAt: visit.startAt,
            customerLocation,
            durationMinutes: Math.max(
              1,
              Math.round(
                (visit.endAt.getTime() - new Date(visit.startAt).getTime()) / 60_000
              )
            ),
            tripType: "one_way",
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data?.error ?? "تعذّر تجهيز طلب السائق");
        }
        const order = data.order as DriverOrderRow;
        setDispatchOrder({
          order: {
            ...order,
            specialist_name: null,
            driver_name: null,
            driver_phone: null,
            customer_name: visit.customerName,
            updated_by_name: null,
          },
          specialistName: visit.services[0]?.providers[0] ?? null,
        });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "تعذّر تجهيز طلب السائق");
      } finally {
        setPreparing(null);
      }
    },
    [followUps, resolveConversation, router]
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

  const openReminder = useCallback((visit: Visit) => {
    setReminderMessage(
      reservationReminderMessage({
        customerName: visit.customerName,
        arrivalAt: visit.startAt,
        services: visit.services.map((service) => service.service),
      }) ?? ""
    );
    setReminderError(null);
    setReminderFor(visit);
  }, []);

  /** Send the exact reminder text the employee reviewed and edited. */
  const sendReminder = useCallback(
    async (visit: Visit, message: string) => {
      setError(null);
      setReminderError(null);
      if (!message.trim()) {
        setReminderError("اكتبي نص التذكير قبل الإرسال");
        return;
      }
      setReminding(visit.key);
      try {
        const conversationId = await resolveConversation(visit);
        const response = await fetch(
          `/api/conversations/${conversationId}/reservation-follow-up`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "remind",
              dayKey: reservationDayKey(visit.startAt),
              message,
            }),
          }
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error ?? "تعذّر إرسال التذكير");
        setFollowUpOverrides((current) => ({
          ...current,
          [visit.key]: data.followUp as ReservationFollowUp,
        }));
        setReminderFor(null);
        setReminderMessage("");
      } catch (e) {
        setReminderError(e instanceof Error ? e.message : "تعذّر إرسال التذكير");
      } finally {
        setReminding(null);
      }
    },
    [resolveConversation]
  );

  /** Record the customer's answer so dispatch never relies on staff memory. */
  const updateFollowUp = useCallback(
    async (visit: Visit, status: ReservationFollowUpStatus) => {
      setError(null);
      setFollowUpBusy(`${visit.key}:${status}`);
      try {
        const conversationId = await resolveConversation(visit);
        const response = await fetch(
          `/api/conversations/${conversationId}/reservation-follow-up`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "set_status",
              dayKey: reservationDayKey(visit.startAt),
              status,
            }),
          }
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data?.error ?? "تعذّر تحديث متابعة العميلة");
        }
        setFollowUpOverrides((current) => ({
          ...current,
          [visit.key]: data.followUp as ReservationFollowUp,
        }));
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "تعذّر تحديث متابعة العميلة"
        );
      } finally {
        setFollowUpBusy(null);
      }
    },
    [resolveConversation]
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
          <Button
            size="sm"
            variant={attentionOnly ? "destructive" : "outline"}
            onClick={() => resetTo(() => setAttentionOnly((current) => !current))}
          >
            <AlertTriangle data-icon="inline-start" />
            تحتاج مراجعة {attentionCount.toLocaleString("ar-SA")}
          </Button>
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
          <Button
            type="button"
            size="sm"
            variant={dateFrom === todayKey && dateTo === todayKey ? "default" : "outline"}
            onClick={() =>
              resetTo(() => {
                setDateFrom(todayKey);
                setDateTo(todayKey);
              })
            }
          >
            حجوزات اليوم مرتبة
          </Button>
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
          {visibleVisits.length.toLocaleString("ar-SA")} زيارة ·{" "}
          {visibleServiceCount.toLocaleString("ar-SA")} خدمة
          {visibleVisits.length !== counts.all
            ? ` من ${counts.all.toLocaleString("ar-SA")} زيارة`
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
              <Suspense fallback={<Skeleton className="h-80 w-full" />}>
                <ArabicCalendar
                  mode="single"
                  selected={dateOfKey(selectedDay)}
                  onSelect={(date) => {
                    if (date) setSelectedDay(DAY_KEY_FMT.format(date));
                  }}
                  modifiers={{ booked: bookedDates }}
                  modifiersClassNames={{
                    booked: "[&_button]:font-bold [&_button]:ring-1 [&_button]:ring-[var(--brand)]/40",
                  }}
                  className="mx-auto w-full [--cell-size:2.5rem]"
                  captionLayout="dropdown"
                />
              </Suspense>
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
                      reminding={reminding === visit.key}
                      followUp={followUps[visit.key]}
                      followUpBusy={followUpBusy?.startsWith(`${visit.key}:`) ?? false}
                      onRemind={() => openReminder(visit)}
                      onConfirm={() => updateFollowUp(visit, "confirmed")}
                      onCancel={() => updateFollowUp(visit, "cancelled")}
                      onReviewDispatch={() => {
                        const order = orderByVisit.get(visit.key);
                        if (order) {
                          setDispatchOrder({
                            order,
                            specialistName: visit.services[0]?.providers[0] ?? null,
                          });
                        }
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          لا توجد زيارات مطابقة.
        </p>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>إجراءات</TableHead>
                <TableHead>متابعة العميلة</TableHead>
                <TableHead>العميلة</TableHead>
                <TableHead>الموعد</TableHead>
                <TableHead>الخدمات</TableHead>
                <TableHead>الأخصائية</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>الإجمالي</TableHead>
                <TableHead>المحادثة</TableHead>
                <TableHead>تفاصيل</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((visit) => {
                const firstService = visit.services[0];
                const arrival = new Date(visit.startAt);
                const dayKey = DAY_KEY_FMT.format(arrival);
                const existing = orderByVisit.get(visit.key);
                const followUp = followUps[visit.key];
                const cancelled = followUp?.status === "cancelled";
                const status = visitStatus(visit);
                const meta = STATUS_META[status] ?? {
                  label: status || "—",
                  variant: "outline" as const,
                };
                const issues = visitIssues(visit);
                const providers = visitProviders(visit);
                const total = visit.services.reduce(
                  (sum, service) => sum + service.amount,
                  0
                );
                const paymentLabels = [
                  ...new Set(
                    visit.services.map(
                      (service) => PAYMENT_LABEL[service.payment] ?? service.payment ?? "—"
                    )
                  ),
                ];
                const sources = [
                  ...new Set(
                    visit.services.map(
                      (service) => SOURCE_LABEL[service.source] ?? service.source ?? "—"
                    )
                  ),
                ];
                const creators = [
                  ...new Set(
                    visit.services.map(
                      (service) =>
                        service.createdBy ||
                        (service.source === "Website" ? "الزبونة" : "—")
                    )
                  ),
                ];
                const orderIds = [
                  ...new Set(
                    visit.services
                      .map((service) => service.order?.id)
                      .filter((id): id is string => Boolean(id))
                  ),
                ];
                const notes = [
                  ...new Set(
                    visit.services
                      .map((service) => service.notes.trim())
                      .filter(Boolean)
                  ),
                ];
                const isOpen = expanded === visit.key;
                return (
                  <Fragment key={visit.key}>
                    <TableRow className={cn(isOpen && "border-b-0 bg-muted/40")}>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {existing?.status === "sent" ? (
                            <Badge variant="outline" className="gap-1 whitespace-nowrap">
                              <CheckCircle2 aria-hidden="true" />
                              تم التأكيد
                            </Badge>
                          ) : existing ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setDispatchOrder({
                                  order: existing,
                                  specialistName: providers[0] ?? null,
                                })
                              }
                              disabled={cancelled}
                            >
                              <Car data-icon="inline-start" />
                              تأكيد الحجز
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() => requestDriver(visit)}
                              disabled={preparing === visit.key || cancelled}
                              className="whitespace-nowrap"
                            >
                              {preparing === visit.key ? (
                                <Loader2 data-icon="inline-start" className="animate-spin" />
                              ) : (
                                <Car data-icon="inline-start" />
                              )}
                              طلب سائق
                            </Button>
                          )}
                          <Button size="icon-sm" variant="ghost" asChild>
                            <a
                              href="https://platform.rekaz.io"
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label="تعديل أو إلغاء الحجز في ركاز"
                              title="تعديل أو إلغاء الحجز في ركاز"
                            >
                              <SquarePen />
                            </a>
                          </Button>
                        </div>
                      </TableCell>

                      <TableCell>
                        <CustomerFollowUpControls
                          followUp={followUp}
                          reminding={reminding === visit.key}
                          busy={
                            followUpBusy?.startsWith(`${visit.key}:`) ?? false
                          }
                          onRemind={() => openReminder(visit)}
                          onConfirm={() => updateFollowUp(visit, "confirmed")}
                          onCancel={() => updateFollowUp(visit, "cancelled")}
                          compact
                        />
                      </TableCell>

                      <TableCell className="max-w-[180px]">
                        <button
                          type="button"
                          onClick={() => openTimeline(visit)}
                          className="block max-w-full text-start"
                          title="عرض سجل العميلة الكامل"
                        >
                          <span className="block truncate font-medium text-[var(--brand)] underline-offset-2 hover:underline">
                            {visit.customerName || "بدون اسم"}
                          </span>
                          <span dir="ltr" className="block text-xs text-muted-foreground">
                            {visit.customerPhone}
                          </span>
                        </button>
                      </TableCell>

                      <TableCell className="whitespace-nowrap">
                        <span className="flex items-center gap-1.5">
                          {DAY_FMT.format(arrival)}
                          {dayKey === todayKey ? (
                            <Badge variant="secondary">اليوم</Badge>
                          ) : null}
                        </span>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {TIME_FMT.format(arrival)} ← {TIME_FMT.format(visit.endAt)}
                        </span>
                      </TableCell>

                      <TableCell className="max-w-[230px]">
                        <div
                          className="flex items-center gap-2"
                          title={visit.services
                            .map((service) => service.service)
                            .join("، ")}
                        >
                          <span className="block truncate">
                            {firstService.service || "—"}
                            {firstService.quantity > 1
                              ? ` ×${firstService.quantity.toLocaleString("ar-SA")}`
                              : ""}
                          </span>
                          {visit.services.length > 1 ? (
                            <Badge variant="secondary" className="shrink-0">
                              +{(visit.services.length - 1).toLocaleString("ar-SA")} أخرى
                            </Badge>
                          ) : null}
                        </div>
                      </TableCell>

                      <TableCell className="max-w-[160px]">
                        <span
                          className="block truncate text-xs"
                          title={providers.join("، ")}
                        >
                          {providers.length ? providers.join("، ") : "—"}
                        </span>
                      </TableCell>

                      <TableCell>
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                        {issues.length ? (
                          <p className="mt-1 max-w-40 text-xs text-destructive" title={issues.join("، ")}>
                            {issues.join(" · ")}
                          </p>
                        ) : null}
                      </TableCell>

                      <TableCell className="whitespace-nowrap">
                        <span className="block font-medium tabular-nums">
                          {riyal(total)}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {paymentLabels.join(" · ")}
                        </span>
                      </TableCell>

                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openConversation(firstService)}
                          disabled={opening === firstService.id}
                          className="whitespace-nowrap"
                        >
                          {opening === firstService.id ? (
                            <Loader2 data-icon="inline-start" className="animate-spin" />
                          ) : (
                            <MessageCircle data-icon="inline-start" />
                          )}
                          المحادثة
                        </Button>
                      </TableCell>

                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-expanded={isOpen}
                          aria-label={`تفاصيل زيارة ${visit.customerName || visit.customerPhone}`}
                          onClick={() => setExpanded(isOpen ? null : visit.key)}
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
                        <TableCell colSpan={10} className="bg-muted/40 p-4">
                          <div className="flex flex-col gap-4">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium">الخدمات في هذه الزيارة</p>
                              <Badge variant="secondary">
                                {visit.services.length.toLocaleString("ar-SA")} خدمة
                              </Badge>
                            </div>

                            <ul className="overflow-hidden rounded-[var(--radius-md)] border bg-background [&>li:not(:last-child)]:border-b">
                              {visit.services.map((service) => {
                                const serviceArrival = new Date(service.arrivalAt);
                                return (
                                  <li
                                    key={service.id}
                                    className="grid gap-3 px-3 py-3 text-xs md:grid-cols-[minmax(180px,1.5fr)_minmax(120px,1fr)_minmax(120px,1fr)_auto] md:items-center"
                                  >
                                    <div className="min-w-0">
                                      <p className="truncate font-medium" title={service.service}>
                                        {service.service || "—"}
                                        {service.quantity > 1
                                          ? ` ×${service.quantity.toLocaleString("ar-SA")}`
                                          : ""}
                                      </p>
                                      <p dir="ltr" className="tabular-nums text-muted-foreground">
                                        {service.id}
                                      </p>
                                    </div>
                                    <div>
                                      <p className="text-muted-foreground">الوقت والمدة</p>
                                      <p className="tabular-nums">
                                        {TIME_FMT.format(serviceArrival)} ←{" "}
                                        {TIME_FMT.format(
                                          new Date(
                                            serviceArrival.getTime() +
                                              service.durationMinutes * 60_000
                                          )
                                        )}
                                        {" · "}
                                        {service.durationMinutes.toLocaleString("ar-SA")} د
                                      </p>
                                    </div>
                                    <div className="min-w-0">
                                      <p className="text-muted-foreground">الأخصائية</p>
                                      <p className="truncate" title={service.providers.join("، ")}>
                                        {service.providers.length
                                          ? service.providers.join("، ")
                                          : "—"}
                                      </p>
                                    </div>
                                    <p className="whitespace-nowrap font-medium tabular-nums">
                                      {riyal(service.amount)}
                                    </p>
                                  </li>
                                );
                              })}
                            </ul>

                            <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                              <Detail label="المصدر" value={sources.join(" · ")} />
                              <Detail label="أُنشئ بواسطة" value={creators.join(" · ")} />
                              <Detail
                                label="تاريخ الإنشاء"
                                value={
                                  firstService.bookedAt
                                    ? STAMP_FMT.format(new Date(firstService.bookedAt))
                                    : "—"
                                }
                              />
                              <Detail
                                label="رقم الطلب"
                                value={orderIds.length ? orderIds.join("، ") : "—"}
                              />
                              {notes.length ? (
                                <Detail label="ملاحظات" value={notes.join(" · ")} />
                              ) : null}
                              {visit.location ? (
                                <div className="sm:col-span-2">
                                  <dt className="text-muted-foreground">الموقع</dt>
                                  <dd>
                                    <a
                                      href={`https://maps.google.com/?q=${visit.location.lat},${visit.location.lng}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1.5 text-[var(--brand)] underline underline-offset-2"
                                    >
                                      <MapPin size={13} aria-hidden="true" />
                                      {visit.location.label || "موقع الزبونة"}
                                      <ExternalLink size={11} aria-hidden="true" />
                                    </a>
                                  </dd>
                                </div>
                              ) : null}
                            </dl>
                          </div>
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

      {dispatchOrder ? (
        <Suspense fallback={null}>
          <DispatchDialog
            order={dispatchOrder.order}
            open
            preferredSpecialistName={dispatchOrder.specialistName}
            onOpenChange={(open) => {
              if (!open) setDispatchOrder(null);
            }}
            onUpdated={(order) => {
              setDispatchOrder((current) =>
                current ? { ...current, order } : current
              );
              router.refresh();
            }}
          />
        </Suspense>
      ) : null}

      {timelineFor ? (
        <Suspense fallback={null}>
          <CustomerTimelineSheet
            phone={timelineFor.phone}
            name={timelineFor.name}
            open
            onClose={() => setTimelineFor(null)}
          />
        </Suspense>
      ) : null}

      <Dialog
        open={Boolean(reminderFor)}
        onOpenChange={(open) => {
          if (!open && !reminding) {
            setReminderFor(null);
            setReminderMessage("");
            setReminderError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {followUps[reminderFor?.key ?? ""]?.reminded_at
                ? "إعادة إرسال التذكير؟"
                : "إرسال تذكير للعميلة؟"}
            </DialogTitle>
            <DialogDescription>
              راجعي الرسالة التي ستصل إلى العميلة عبر واتساب قبل الإرسال.
            </DialogDescription>
          </DialogHeader>
          {reminderFor ? (
            <FieldGroup>
              <Field data-invalid={Boolean(reminderError)}>
                <FieldLabel htmlFor={`reminder-message-${reminderFor.key}`}>
                  نص رسالة واتساب
                </FieldLabel>
                <Textarea
                  id={`reminder-message-${reminderFor.key}`}
                  value={reminderMessage}
                  onChange={(event) => {
                    setReminderMessage(event.target.value);
                    setReminderError(null);
                  }}
                  maxLength={MAX_RESERVATION_REMINDER_LENGTH}
                  className="min-h-40 leading-7"
                  aria-invalid={Boolean(reminderError)}
                  disabled={Boolean(reminding)}
                />
                <FieldDescription>
                  هذه هي الرسالة نفسها التي ستُرسل. يمكنك تعديلها قبل التأكيد. ·{" "}
                  {reminderMessage.length.toLocaleString("ar-SA")} من{" "}
                  {MAX_RESERVATION_REMINDER_LENGTH.toLocaleString("ar-SA")}
                </FieldDescription>
                {reminderError ? <FieldError>{reminderError}</FieldError> : null}
              </Field>
              <p dir="ltr" className="text-start text-xs text-muted-foreground">
                {reminderFor.customerPhone}
              </p>
            </FieldGroup>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setReminderFor(null);
                setReminderMessage("");
                setReminderError(null);
              }}
              disabled={Boolean(reminding)}
            >
              رجوع
            </Button>
            <Button
              type="button"
              onClick={() =>
                reminderFor && void sendReminder(reminderFor, reminderMessage)
              }
              disabled={
                !reminderFor || !reminderMessage.trim() || Boolean(reminding)
              }
            >
              {reminding ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : (
                <Bell data-icon="inline-start" />
              )}
              إرسال التذكير
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  reminding,
  followUp,
  followUpBusy,
  onRemind,
  onConfirm,
  onCancel,
  onReviewDispatch,
}: {
  visit: Visit;
  order: DriverOrderRow | undefined;
  preparing: boolean;
  opening: boolean;
  onRequestDriver: () => void;
  onOpenConversation: () => void;
  onOpenTimeline: () => void;
  reminding: boolean;
  followUp: ReservationFollowUp | undefined;
  followUpBusy: boolean;
  onRemind: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onReviewDispatch: () => void;
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
        <CustomerFollowUpControls
          followUp={followUp}
          reminding={reminding}
          busy={followUpBusy}
          onRemind={onRemind}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
        <div className="flex flex-wrap gap-1.5">
          {order?.status === "sent" ? (
            <Badge variant="outline" className="gap-1">
              <CheckCircle2 aria-hidden="true" />
              تم التأكيد
            </Badge>
          ) : order ? (
            <Button
              size="sm"
              variant="outline"
              onClick={onReviewDispatch}
              disabled={followUp?.status === "cancelled"}
            >
              <Car data-icon="inline-start" />
              تأكيد الحجز
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={onRequestDriver}
              disabled={preparing || followUp?.status === "cancelled"}
            >
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
          <Button size="sm" variant="ghost" asChild>
            <a href="https://platform.rekaz.io" target="_blank" rel="noopener noreferrer">
              <SquarePen data-icon="inline-start" />
              تعديل أو إلغاء
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CustomerFollowUpControls({
  followUp,
  reminding,
  busy,
  onRemind,
  onConfirm,
  onCancel,
  compact = false,
}: {
  followUp: ReservationFollowUp | undefined;
  reminding: boolean;
  busy: boolean;
  onRemind: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  compact?: boolean;
}) {
  const variant =
    followUp?.status === "confirmed"
      ? "default"
      : followUp?.status === "cancelled"
        ? "destructive"
        : followUp?.status === "awaiting_reply"
          ? "secondary"
          : "outline";
  const reminded = Boolean(followUp?.reminded_at);

  return (
    <div className="flex flex-col items-start gap-1.5">
      <Badge variant={variant}>
        {followUp
          ? RESERVATION_FOLLOW_UP_LABEL[followUp.status]
          : "لم تتم المتابعة"}
      </Badge>
      <div className="flex flex-wrap gap-1">
        <Button
          size={compact ? "icon-sm" : "sm"}
          variant="outline"
          onClick={onRemind}
          disabled={reminding || busy || followUp?.status === "cancelled"}
          aria-label={reminded ? "إعادة تذكير العميلة" : "تذكير العميلة"}
          title={reminded ? "إعادة تذكير العميلة" : "تذكير العميلة"}
        >
          {reminding ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Bell data-icon={compact ? undefined : "inline-start"} />
          )}
          {compact ? null : reminded ? "إعادة تذكير" : "تذكير العميلة"}
        </Button>
        <Button
          size={compact ? "icon-sm" : "sm"}
          variant={followUp?.status === "confirmed" ? "default" : "outline"}
          onClick={onConfirm}
          disabled={busy || reminding || followUp?.status === "confirmed"}
          aria-label="تسجيل تأكيد حضور العميلة"
          title="أكدت العميلة الحضور"
        >
          <Check data-icon={compact ? undefined : "inline-start"} />
          {compact ? null : "أكدت"}
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size={compact ? "icon-sm" : "sm"}
              variant={followUp?.status === "cancelled" ? "destructive" : "outline"}
              disabled={busy || reminding || followUp?.status === "cancelled"}
              aria-label="تسجيل إلغاء العميلة للحجز"
              title="ألغت العميلة الحجز"
            >
              <X data-icon={compact ? undefined : "inline-start"} />
              {compact ? null : "ألغت"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>تسجيل إلغاء العميلة؟</AlertDialogTitle>
              <AlertDialogDescription>
                سيظهر الحجز كملغي من العميلة، وسيتوقف طلب سائق جديد لهذه الزيارة.
                لا يغيّر هذا حالة الحجز داخل ركاز؛ افتحي ركاز لإلغائه هناك أيضاً.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>رجوع</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={onCancel}>
                نعم، ألغت العميلة
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
