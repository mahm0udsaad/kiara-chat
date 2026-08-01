"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { arSA } from "date-fns/locale";
import {
  AlertTriangle,
  CalendarDays,
  Car,
  CheckCircle2,
  Clock3,
  ExternalLink,
  MapPin,
  MessageSquareText,
  RefreshCw,
  Send,
  UserRound,
  Wallet,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import { loadDispatchOptions } from "@/lib/dispatch-options-client";
import { formatDuration, formatRelativeTime, TRIP_TYPE_LABEL } from "@/lib/format";
import { nationalityOf } from "@/lib/nationalities";
import type {
  Driver,
  DriverOrderRow,
  DriverOrderStatus,
  Specialist,
} from "@/lib/types";

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
const DAY_KEY_FMT = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: TZ,
});

const dateOfKey = (key: string) => new Date(`${key}T12:00:00+03:00`);
const isolateLtr = (value: string) => `\u2066${value}\u2069`;

type StatusFilter = "all" | DriverOrderStatus;
type OrdersView = "daily" | "calendar";

const STATUS_FILTERS: [StatusFilter, string][] = [
  ["all", "كل الحالات"],
  ["pending", "بانتظار الإرسال"],
  ["sent", "مُرسلة"],
  ["failed", "فشل الإرسال"],
];

function statusMeta(order: DriverOrderRow): {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
} {
  if (!order.driver_id) return { label: "بانتظار سائق", variant: "secondary" };
  if (order.status === "sent") return { label: "مُرسل", variant: "default" };
  if (order.status === "failed") {
    return { label: "فشل الإرسال", variant: "destructive" };
  }
  return { label: "جارٍ الإرسال", variant: "outline" };
}

export function OrdersClient({
  initialOrders,
  isAdmin,
  todayKey,
}: {
  initialOrders: DriverOrderRow[];
  isAdmin: boolean;
  todayKey: string;
}) {
  const [orders, setOrders] = useState(initialOrders);
  const [view, setView] = useState<OrdersView>("daily");
  const [selectedDay, setSelectedDay] = useState(todayKey);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [driverId, setDriverId] = useState("all");
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const response = await fetch("/api/orders", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data?.error ?? "تعذّر تحديث الطلبات");
        return;
      }
      setOrders((data.orders ?? []) as DriverOrderRow[]);
    } catch {
      setError("تعذّر تحديث الطلبات");
    } finally {
      setRefreshing(false);
    }
  }, []);

  const replaceOrder = useCallback((next: DriverOrderRow) => {
    setOrders((previous) =>
      previous.map((order) => (order.id === next.id ? next : order))
    );
  }, []);

  const driverOptions = useMemo(() => {
    const names = new Map<string, string>();
    for (const order of orders) {
      if (order.driver_id) {
        names.set(order.driver_id, order.driver_name ?? "سائق محذوف");
      }
    }
    return [...names].sort((a, b) => a[1].localeCompare(b[1], "ar"));
  }, [orders]);

  const matchesFilters = useCallback(
    (order: DriverOrderRow) => {
      if (status !== "all" && order.status !== status) return false;
      if (driverId === "unassigned" && order.driver_id) return false;
      if (
        driverId !== "all" &&
        driverId !== "unassigned" &&
        order.driver_id !== driverId
      ) {
        return false;
      }
      return true;
    },
    [driverId, status]
  );

  const ordersByDay = useMemo(() => {
    const grouped = new Map<string, DriverOrderRow[]>();
    for (const order of orders) {
      const key = DAY_KEY_FMT.format(new Date(order.arrival_at));
      const rows = grouped.get(key);
      if (rows) rows.push(order);
      else grouped.set(key, [order]);
    }
    return grouped;
  }, [orders]);

  const dayRows = useMemo(
    () =>
      (ordersByDay.get(selectedDay) ?? [])
        .filter(matchesFilters)
        .toSorted((a, b) => a.arrival_at.localeCompare(b.arrival_at)),
    [matchesFilters, ordersByDay, selectedDay]
  );

  const searchRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    return orders.filter((order) => {
      if (!matchesFilters(order)) return false;
      return [
        order.driver_name,
        order.specialist_name,
        order.customer_name,
        order.customer_phone,
        order.driver_phone,
        order.customer_location,
      ]
        .filter(Boolean)
        .some((value) => (value as string).toLowerCase().includes(normalized));
    });
  }, [matchesFilters, orders, query]);

  const shown = query.trim() ? searchRows : dayRows;
  const stats = useMemo(() => {
    let sent = 0;
    let pending = 0;
    let failed = 0;
    let revenue = 0;
    for (const order of shown) {
      if (!order.driver_id || order.status === "pending") pending += 1;
      else if (order.status === "sent") sent += 1;
      else failed += 1;
      revenue += order.price ?? 0;
    }
    return { total: shown.length, sent, pending, failed, revenue };
  }, [shown]);

  const bookedDates = useMemo(
    () => [...ordersByDay.keys()].map(dateOfKey),
    [ordersByDay]
  );
  const failedDates = useMemo(
    () =>
      [...ordersByDay.entries()]
        .filter(([, rows]) => rows.some((order) => order.status === "failed"))
        .map(([key]) => dateOfKey(key)),
    [ordersByDay]
  );

  const selectedLabel =
    selectedDay === todayKey ? "طلبات اليوم" : DAY_FMT.format(dateOfKey(selectedDay));

  return (
    <div className="dashboard-page max-w-6xl">
      <div className="dashboard-page-header">
        <div>
          <h1>الطلبات</h1>
          <p>
            ابدئي بطلبات اليوم، أو افتحي التقويم لمراجعة الحجوزات القادمة وإرسال
            تفاصيل السائق في خطوتين واضحتين.
          </p>
        </div>
        <Button
          variant="outline"
          size="lg"
          className="min-h-11 shrink-0"
          onClick={refresh}
          disabled={refreshing}
        >
          {refreshing ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <RefreshCw data-icon="inline-start" />
          )}
          تحديث
        </Button>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard icon={CalendarDays} label="كل الطلبات" value={stats.total} />
        <StatCard icon={Clock3} label="بانتظار الإرسال" value={stats.pending} />
        <StatCard icon={Send} label="مُرسلة" value={stats.sent} />
        <StatCard icon={AlertTriangle} label="فشل إرسالها" value={stats.failed} />
        {isAdmin ? (
          <StatCard
            icon={Wallet}
            label="إجمالي الأجرة"
            value={stats.revenue}
            suffix=" ر.س"
          />
        ) : null}
      </div>

      <Card className="mb-5">
        <CardHeader>
          <CardTitle>البحث والتصفية</CardTitle>
          <CardDescription>
            البحث يعرض النتائج من جميع الأيام، أما الفلاتر فتُطبّق على العرض الحالي.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ابحثي بالزبونة أو الأخصائية أو السائق أو الموقع…"
            aria-label="البحث في الطلبات"
            className="min-h-11"
          />
          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup
              type="single"
              value={status}
              onValueChange={(value) =>
                value && setStatus(value as StatusFilter)
              }
              variant="outline"
              spacing={1}
              className="flex-wrap"
              aria-label="تصفية حالة الطلب"
            >
              {STATUS_FILTERS.map(([value, label]) => (
                <ToggleGroupItem key={value} value={value} className="min-h-9">
                  {label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <Select value={driverId} onValueChange={setDriverId}>
              <SelectTrigger className="min-h-9 min-w-40" aria-label="تصفية بالسائق">
                <SelectValue placeholder="كل السائقين" />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectGroup>
                  <SelectItem value="all">كل السائقين</SelectItem>
                  <SelectItem value="unassigned">دون سائق</SelectItem>
                  {driverOptions.map(([id, name]) => (
                    <SelectItem key={id} value={id}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <Alert variant="destructive" className="mb-5">
          <AlertTriangle />
          <AlertTitle>تعذّر تحديث الطلبات</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {query.trim() ? (
        <OrdersGrid
          title={`نتائج البحث (${searchRows.length.toLocaleString("ar")})`}
          orders={searchRows}
          isAdmin={isAdmin}
          onUpdated={replaceOrder}
          emptyText="لا توجد طلبات مطابقة للبحث."
        />
      ) : (
        <Tabs
          value={view}
          onValueChange={(value) => setView(value as OrdersView)}
          className="gap-4"
        >
          <TabsList>
            <TabsTrigger value="daily" onClick={() => setView("daily")}>
              <Clock3 data-icon="inline-start" />
              العرض اليومي
            </TabsTrigger>
            <TabsTrigger value="calendar" onClick={() => setView("calendar")}>
              <CalendarDays data-icon="inline-start" />
              التقويم
            </TabsTrigger>
          </TabsList>

          <TabsContent value="daily">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">{selectedLabel}</h2>
                <p className="text-sm text-muted-foreground">
                  {dayRows.length.toLocaleString("ar")} حجز في هذا اليوم
                </p>
              </div>
              {selectedDay !== todayKey ? (
                <Button variant="outline" onClick={() => setSelectedDay(todayKey)}>
                  العودة إلى اليوم
                </Button>
              ) : null}
            </div>
            <OrdersGrid
              orders={dayRows}
              isAdmin={isAdmin}
              onUpdated={replaceOrder}
              emptyText={
                orders.length
                  ? "لا توجد حجوزات في هذا اليوم."
                  : "لا توجد حجوزات بعد. أنشئي أول حجز من زر «حجز» داخل المحادثة."
              }
            />
          </TabsContent>

          <TabsContent value="calendar">
            <div className="grid items-start gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
              <Card>
                <CardHeader>
                  <CardTitle>تقويم الحجوزات</CardTitle>
                  <CardDescription>
                    الأيام المعلّمة تحتوي حجوزات؛ الأحمر يعني وجود إرسال فاشل.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Calendar
                    mode="single"
                    selected={dateOfKey(selectedDay)}
                    onSelect={(date) => {
                      if (date) setSelectedDay(DAY_KEY_FMT.format(date));
                    }}
                    locale={arSA}
                    modifiers={{ booked: bookedDates, failed: failedDates }}
                    modifiersClassNames={{
                      booked: "[&_button]:ring-1 [&_button]:ring-primary/30",
                      failed: "[&_button]:text-destructive [&_button]:ring-destructive/30",
                    }}
                    className="mx-auto w-full [--cell-size:2.75rem]"
                    captionLayout="dropdown"
                  />
                </CardContent>
              </Card>

              <div>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-semibold">{selectedLabel}</h2>
                    <p className="text-sm text-muted-foreground">
                      اختاري أي حجز لعرض تفاصيله أو طلب السائق.
                    </p>
                  </div>
                  <Button variant="outline" onClick={() => setView("daily")}>
                    عرض القائمة
                  </Button>
                </div>
                <OrdersGrid
                  orders={dayRows}
                  isAdmin={isAdmin}
                  onUpdated={replaceOrder}
                  emptyText="لا توجد حجوزات في التاريخ المختار."
                />
              </div>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function OrdersGrid({
  title,
  orders,
  isAdmin,
  onUpdated,
  emptyText,
}: {
  title?: string;
  orders: DriverOrderRow[];
  isAdmin: boolean;
  onUpdated: (order: DriverOrderRow) => void;
  emptyText: string;
}) {
  if (!orders.length) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Car />
          </EmptyMedia>
          <EmptyTitle>لا توجد طلبات</EmptyTitle>
          <EmptyDescription>{emptyText}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      {title ? <h2 className="text-lg font-semibold">{title}</h2> : null}
      <ul className="grid gap-3 lg:grid-cols-2">
        {orders.map((order) => (
          <OrderCard
            key={order.id}
            order={order}
            isAdmin={isAdmin}
            onUpdated={onUpdated}
          />
        ))}
      </ul>
    </section>
  );
}

function OrderCard({
  order,
  isAdmin,
  onUpdated,
}: {
  order: DriverOrderRow;
  isAdmin: boolean;
  onUpdated: (order: DriverOrderRow) => void;
}) {
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [resending, setResending] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const arrival = new Date(order.arrival_at);
  const status = statusMeta(order);
  const isLocationLink = /^https?:\/\//i.test(order.customer_location.trim());

  const resend = useCallback(async () => {
    setResending(true);
    setNote(null);
    try {
      const response = await fetch(`/api/orders/${order.id}/resend`, {
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNote({ ok: false, text: data?.error ?? "تعذّرت إعادة الإرسال" });
        return;
      }
      onUpdated(data.order as DriverOrderRow);
      setNote(
        data.sent
          ? { ok: true, text: "تم إرسال الطلب للسائق مرة أخرى." }
          : { ok: false, text: "لم تصل الرسالة للسائق. تحققي من ربط واتساب." }
      );
    } catch {
      setNote({ ok: false, text: "تعذّرت إعادة الإرسال" });
    } finally {
      setResending(false);
    }
  }, [onUpdated, order.id]);

  return (
    <li>
      <Card className="h-full">
        <CardHeader>
          <CardTitle>
            {TIME_FMT.format(arrival)} · {order.customer_name ?? "زبونة"}
          </CardTitle>
          <CardDescription>
            {formatDuration(order.duration_minutes)} · {TRIP_TYPE_LABEL[order.trip_type]}
          </CardDescription>
          <CardAction>
            <Badge variant={status.variant}>{status.label}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-start gap-2 text-sm">
            <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            {isLocationLink ? (
              <a
                href={order.customer_location.trim()}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary underline underline-offset-4"
              >
                فتح موقع الزبونة
                <ExternalLink className="size-3" aria-hidden="true" />
              </a>
            ) : (
              <span className="break-words">{order.customer_location}</span>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <UserRound className="size-4" aria-hidden="true" />
            {order.specialist_name ?? "لم تُحدد الأخصائية بعد"}
          </div>
          {note ? (
            <Alert variant={note.ok ? "default" : "destructive"}>
              {note.ok ? <CheckCircle2 /> : <AlertTriangle />}
              <AlertDescription>{note.text}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
        <CardFooter className="justify-between gap-2">
          <Button variant="ghost" onClick={() => setDetailsOpen(true)}>
            المزيد من التفاصيل
          </Button>
          {!order.driver_id ? (
            <Button
              onClick={() => setDispatchOpen(true)}
              onPointerEnter={() => void loadDispatchOptions()}
              onFocus={() => void loadDispatchOptions()}
            >
              <Car data-icon="inline-start" />
              طلب سائق
            </Button>
          ) : (
            <Button
              variant={order.status === "failed" ? "default" : "outline"}
              onClick={resend}
              disabled={resending}
            >
              {resending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Send data-icon="inline-start" />
              )}
              إعادة الإرسال
            </Button>
          )}
        </CardFooter>
      </Card>

      <OrderDetailsSheet
        order={order}
        isAdmin={isAdmin}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
      />
      <DispatchDialog
        order={order}
        open={dispatchOpen}
        onOpenChange={setDispatchOpen}
        onUpdated={onUpdated}
      />
    </li>
  );
}

function OrderDetailsSheet({
  order,
  isAdmin,
  open,
  onOpenChange,
}: {
  order: DriverOrderRow;
  isAdmin: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const arrival = new Date(order.arrival_at);
  const status = statusMeta(order);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>تفاصيل الحجز</SheetTitle>
          <SheetDescription>{DAY_FMT.format(arrival)}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-2xl font-semibold tabular-nums">
              {TIME_FMT.format(arrival)}
            </span>
            <Badge variant={status.variant}>{status.label}</Badge>
          </div>
          <Separator />
          <dl className="flex flex-col gap-4">
            <DetailRow label="الزبونة">
              {order.customer_name ?? "—"} · <span dir="ltr">{order.customer_phone}</span>
            </DetailRow>
            <DetailRow label="الموقع">{order.customer_location}</DetailRow>
            <DetailRow label="الأخصائية">{order.specialist_name ?? "لم تُحدد"}</DetailRow>
            <DetailRow label="السائق">
              {order.driver_name ?? "لم يُحدد"}
              {order.driver_phone ? (
                <> · <span dir="ltr">{order.driver_phone}</span></>
              ) : null}
            </DetailRow>
            <DetailRow label="مدة الجلسة">
              {formatDuration(order.duration_minutes)}
            </DetailRow>
            <DetailRow label="نوع الرحلة">
              {TRIP_TYPE_LABEL[order.trip_type]}
            </DetailRow>
            {isAdmin && order.price != null ? (
              <DetailRow label="أجرة السائق">
                {order.price.toLocaleString("ar-SA")} ر.س
              </DetailRow>
            ) : null}
          </dl>
          <Separator />
          <p className="text-xs text-muted-foreground">
            أُنشئ {formatRelativeTime(order.created_at)}
            {order.sent_at ? ` · أُرسل ${formatRelativeTime(order.sent_at)}` : ""}
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm">{children}</dd>
    </div>
  );
}

function DispatchDialog({
  order,
  open,
  onOpenChange,
  onUpdated,
}: {
  order: DriverOrderRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: (order: DriverOrderRow) => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [specialists, setSpecialists] = useState<Specialist[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [specialistId, setSpecialistId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [specialistNote, setSpecialistNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    sent: boolean;
    specialistSent: boolean | null;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void loadDispatchOptions()
      .then((options) => {
        if (cancelled) return;
        setSpecialists(options.specialists);
        setDrivers(options.drivers);
        setSpecialistId((current) => current || options.specialists[0]?.id || "");
        setDriverId((current) => current || options.drivers[0]?.id || "");
      })
      .catch(() => {
        if (!cancelled) setError("تعذّر تحميل الأخصائيات والسائقين");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const selectedSpecialist = specialists.find((item) => item.id === specialistId);
  const selectedDriver = drivers.find((item) => item.id === driverId);
  const language = nationalityOf(selectedSpecialist?.nationality)?.languageLabel ?? "العربية";
  const driverPreview = useMemo(
    () =>
      [
        "🚗 طلب جديد",
        `الأخصائية: ${selectedSpecialist?.full_name ?? "—"}`,
        `موعد الوصول: ${DAY_FMT.format(new Date(order.arrival_at))}، ${TIME_FMT.format(
          new Date(order.arrival_at)
        )}`,
        `مدة الجلسة: ${formatDuration(order.duration_minutes)}`,
        `نوع الرحلة: ${TRIP_TYPE_LABEL[order.trip_type]}`,
        `موقع الزبونة: ${order.customer_location}`,
        `رقم الزبونة: ${isolateLtr(order.customer_phone)}`,
      ].join("\n"),
    [order, selectedSpecialist?.full_name]
  );

  const reset = useCallback(() => {
    setStep(1);
    setSpecialistId("");
    setDriverId("");
    setSpecialistNote("");
    setConfirmed(false);
    setLoading(true);
    setSubmitting(false);
    setError(null);
    setResult(null);
  }, []);

  const changeOpen = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) reset();
      onOpenChange(nextOpen);
    },
    [onOpenChange, reset]
  );

  const nextStep = useCallback(() => {
    setError(null);
    if (!specialistId) {
      setError("اختاري الأخصائية");
      return;
    }
    setStep(2);
  }, [specialistId]);

  const send = useCallback(async () => {
    setError(null);
    if (!driverId) {
      setError("اختاري السائق");
      return;
    }
    if (!confirmed) {
      setError("أكدي مراجعة رسالة السائق قبل الإرسال");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`/api/orders/${order.id}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ specialistId, driverId, specialistNote }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data?.error ?? "تعذّر إرسال طلب السائق");
        return;
      }
      onUpdated(data.order as DriverOrderRow);
      setResult({
        sent: Boolean(data.sent),
        specialistSent:
          typeof data.specialistSent === "boolean" ? data.specialistSent : null,
      });
    } catch {
      setError("تعذّر إرسال طلب السائق");
    } finally {
      setSubmitting(false);
    }
  }, [confirmed, driverId, onUpdated, order.id, specialistId, specialistNote]);

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>طلب سائق</DialogTitle>
          <DialogDescription>
            {result
              ? "اكتملت معالجة الطلب."
              : `الخطوة ${step.toLocaleString("ar")} من ٢ — ${
                  step === 1 ? "الأخصائية والرسالة" : "السائق والتأكيد"
                }`}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="flex flex-col gap-4">
            <Alert variant={result.sent ? "default" : "destructive"}>
              {result.sent ? <CheckCircle2 /> : <AlertTriangle />}
              <AlertTitle>
                {result.sent ? "تم إرسال الطلب للسائق" : "تم حفظ الطلب ولم يُرسل"}
              </AlertTitle>
              <AlertDescription>
                {result.sent
                  ? "وصلت رسالة تفاصيل الموعد إلى السائق."
                  : "تحققي من ربط واتساب ثم استخدمي إعادة الإرسال من البطاقة."}
              </AlertDescription>
            </Alert>
            {result.specialistSent !== null ? (
              <Alert variant={result.specialistSent ? "default" : "destructive"}>
                <MessageSquareText />
                <AlertTitle>رسالة الأخصائية</AlertTitle>
                <AlertDescription>
                  {result.specialistSent
                    ? `أُرسلت نسخة الموعد إلى الأخصائية باللغة ${language}.`
                    : "تعذّر إرسال نسخة الأخصائية؛ راجعي رقمها وربط واتساب."}
                </AlertDescription>
              </Alert>
            ) : null}
            <DialogFooter>
              <Button onClick={() => changeOpen(false)}>تم</Button>
            </DialogFooter>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Spinner />
            جارٍ تحميل القوائم…
          </div>
        ) : !specialists.length || !drivers.length ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UserRound />
              </EmptyMedia>
              <EmptyTitle>القوائم غير مكتملة</EmptyTitle>
              <EmptyDescription>
                يجب إضافة أخصائية وسائق نشطين من صفحة الفريق أولًا.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <div className="flex items-center gap-2" aria-hidden="true">
              <Badge variant={step === 1 ? "default" : "secondary"}>١</Badge>
              <Separator className="flex-1" />
              <Badge variant={step === 2 ? "default" : "secondary"}>٢</Badge>
            </div>

            {step === 1 ? (
              <FieldGroup>
                <Field data-invalid={!specialistId && Boolean(error)}>
                  <FieldLabel htmlFor="dispatch-specialist">الأخصائية</FieldLabel>
                  <Select value={specialistId} onValueChange={setSpecialistId}>
                    <SelectTrigger
                      id="dispatch-specialist"
                      className="min-h-11 w-full"
                      aria-invalid={!specialistId && Boolean(error)}
                    >
                      <SelectValue placeholder="اختاري الأخصائية" />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      <SelectGroup>
                        {specialists.map((specialist) => (
                          <SelectItem key={specialist.id} value={specialist.id}>
                            {specialist.full_name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="specialist-message">
                    رسالة للأخصائية
                  </FieldLabel>
                  <Textarea
                    id="specialist-message"
                    value={specialistNote}
                    onChange={(event) => setSpecialistNote(event.target.value)}
                    maxLength={500}
                    placeholder="اكتبي ملاحظة الموعد أو تعليمات الوصول…"
                    className="min-h-28"
                  />
                  <FieldDescription>
                    ستُترجم تفاصيل الحجز وهذه الرسالة إلى {language} قبل إرسالها
                    للأخصائية.
                  </FieldDescription>
                </Field>
                {error ? <FieldError>{error}</FieldError> : null}
              </FieldGroup>
            ) : (
              <FieldGroup>
                <Field data-invalid={!driverId && Boolean(error)}>
                  <FieldLabel htmlFor="dispatch-driver">السائق</FieldLabel>
                  <Select value={driverId} onValueChange={setDriverId}>
                    <SelectTrigger
                      id="dispatch-driver"
                      className="min-h-11 w-full"
                      aria-invalid={!driverId && Boolean(error)}
                    >
                      <SelectValue placeholder="اختاري السائق" />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      <SelectGroup>
                        {drivers.map((driver) => (
                          <SelectItem key={driver.id} value={driver.id}>
                            {driver.full_name} · {isolateLtr(driver.phone)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>

                <Card size="sm">
                  <CardHeader>
                    <CardTitle>معاينة رسالة السائق</CardTitle>
                    <CardDescription>
                      ستُرسل إلى {selectedDriver?.full_name ?? "السائق المختار"}.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="whitespace-pre-wrap text-sm leading-7">
                      {driverPreview}
                    </p>
                  </CardContent>
                </Card>

                <Field
                  orientation="horizontal"
                  data-invalid={!confirmed && Boolean(error)}
                >
                  <Checkbox
                    id="confirm-driver-message"
                    checked={confirmed}
                    onCheckedChange={(checked) => setConfirmed(checked === true)}
                    aria-invalid={!confirmed && Boolean(error)}
                  />
                  <FieldContent>
                    <FieldTitle>
                      <FieldLabel htmlFor="confirm-driver-message">
                        راجعت الرسالة وأؤكد إرسالها للسائق
                      </FieldLabel>
                    </FieldTitle>
                    <FieldDescription>
                      سيُحفظ اختيار الأخصائية والسائق حتى لو تعذّر إرسال واتساب.
                    </FieldDescription>
                  </FieldContent>
                </Field>
                {error ? <FieldError>{error}</FieldError> : null}
              </FieldGroup>
            )}

            <DialogFooter>
              {step === 2 ? (
                <Button variant="outline" onClick={() => setStep(1)}>
                  السابق
                </Button>
              ) : (
                <Button variant="outline" onClick={() => changeOpen(false)}>
                  إلغاء
                </Button>
              )}
              {step === 1 ? (
                <Button onClick={nextStep}>التالي</Button>
              ) : (
                <Button onClick={send} disabled={submitting || !confirmed}>
                  {submitting ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <Send data-icon="inline-start" />
                  )}
                  {submitting ? "جارٍ الإرسال…" : "إرسال"}
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  suffix = "",
}: {
  icon: typeof CalendarDays;
  label: string;
  value: number;
  suffix?: string;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          <Icon />
          {label}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tabular-nums">
          {value.toLocaleString("ar")}
          {suffix ? <span className="text-sm font-normal">{suffix}</span> : null}
        </p>
      </CardContent>
    </Card>
  );
}
