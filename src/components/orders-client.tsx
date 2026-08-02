"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Mic,
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
import {
  VoiceNoteRecorder,
  type VoiceNote,
} from "@/components/voice-note-recorder";
import { loadDispatchOptions } from "@/lib/dispatch-options-client";
import { formatDuration, formatRelativeTime, TRIP_TYPE_LABEL } from "@/lib/format";
import { nationalityOf } from "@/lib/nationalities";
import { phoneMatches } from "@/lib/phone";
import type {
  Driver,
  DriverOrderRow,
  DriverOrderStatus,
  Specialist,
  TripType,
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
/** How the staff note reaches the specialist: typed, or in their own voice. */
type NoteMode = "text" | "voice";

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
      // Phones are stored E.164 but get typed as "0502376231", so they match
      // on the normalized national number rather than as plain text.
      if (
        phoneMatches(order.customer_phone, normalized) ||
        phoneMatches(order.driver_phone, normalized)
      ) {
        return true;
      }
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
        onUpdated={onUpdated}
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

const pad2 = (n: number) => String(n).padStart(2, "0");
/** Native date/time inputs speak local wall-clock — the salon's own timezone. */
const toDateInput = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const toTimeInput = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const DURATION_PRESETS = [30, 45, 60, 90, 120] as const;

/**
 * Everything the booking sheet collected, editable afterwards: plans move, a
 * customer sends a better pin, a driver swaps out. Saving never re-sends — an
 * order already on a driver's WhatsApp says so, and the card's "إعادة الإرسال"
 * stays the deliberate way to push the change to them.
 */
function OrderDetailsSheet({
  order,
  isAdmin,
  open,
  onOpenChange,
  onUpdated,
}: {
  order: DriverOrderRow;
  isAdmin: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: (order: DriverOrderRow) => void;
}) {
  const arrival = new Date(order.arrival_at);
  const status = statusMeta(order);

  const [date, setDate] = useState(() => toDateInput(arrival));
  const [time, setTime] = useState(() => toTimeInput(arrival));
  const [location, setLocation] = useState(order.customer_location);
  const [duration, setDuration] = useState(String(order.duration_minutes));
  const [tripType, setTripType] = useState<TripType>(order.trip_type);
  const [specialistId, setSpecialistId] = useState(order.specialist_id ?? "");
  const [driverId, setDriverId] = useState(order.driver_id ?? "");
  const [price, setPrice] = useState(order.price == null ? "" : String(order.price));
  const [specialists, setSpecialists] = useState<Specialist[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const seed = useCallback(() => {
    const next = new Date(order.arrival_at);
    setDate(toDateInput(next));
    setTime(toTimeInput(next));
    setLocation(order.customer_location);
    setDuration(String(order.duration_minutes));
    setTripType(order.trip_type);
    setSpecialistId(order.specialist_id ?? "");
    setDriverId(order.driver_id ?? "");
    setPrice(order.price == null ? "" : String(order.price));
    setError(null);
    setSaved(false);
  }, [order]);

  // Re-seed once per opening, so the sheet never shows a stale edit from a
  // previous visit (or values the dispatch dialog changed in the meantime) —
  // and never overwrites what is being typed while it stays open.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!open) {
      seededRef.current = false;
      return;
    }
    if (seededRef.current) return;
    seededRef.current = true;
    seed();
  }, [open, seed]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void loadDispatchOptions()
      .then((options) => {
        if (cancelled) return;
        setSpecialists(options.specialists);
        setDrivers(options.drivers);
      })
      .catch(() => {
        if (!cancelled) setError("تعذّر تحميل الأخصائيات والسائقين");
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const arrivalIso = useMemo(() => {
    if (!date || !time) return null;
    const [hour, minute] = time.split(":").map(Number);
    const next = new Date(`${date}T00:00:00`);
    if (Number.isNaN(next.getTime())) return null;
    next.setHours(hour, minute, 0, 0);
    return next.toISOString();
  }, [date, time]);

  const dirty =
    (arrivalIso !== null && arrivalIso !== new Date(order.arrival_at).toISOString()) ||
    location.trim() !== order.customer_location ||
    Number(duration) !== order.duration_minutes ||
    tripType !== order.trip_type ||
    (specialistId || null) !== order.specialist_id ||
    (driverId || null) !== order.driver_id ||
    (isAdmin && (price === "" ? null : Number(price)) !== order.price);

  const save = useCallback(async () => {
    setError(null);
    if (!arrivalIso) return setError("موعد الوصول غير صحيح");
    if (!location.trim()) return setError("موقع الزبونة مطلوب");
    const minutes = Number(duration);
    if (!Number.isFinite(minutes) || minutes < 5) return setError("مدة الجلسة غير صحيحة");

    setSaving(true);
    try {
      const res = await fetch(`/api/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          arrivalAt: arrivalIso,
          customerLocation: location.trim(),
          durationMinutes: minutes,
          tripType,
          specialistId: specialistId || null,
          driverId: driverId || null,
          ...(isAdmin ? { price: price === "" ? null : Number(price) } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data?.error ?? "تعذّر حفظ التعديل");
      onUpdated(data.order as DriverOrderRow);
      setSaved(true);
    } catch {
      setError("تعذّر حفظ التعديل");
    } finally {
      setSaving(false);
    }
  }, [
    arrivalIso,
    location,
    duration,
    tripType,
    specialistId,
    driverId,
    price,
    isAdmin,
    order.id,
    onUpdated,
  ]);

  // Presets cover the usual sessions; an order booked at some other length
  // keeps its own chip rather than being rounded into one of ours.
  const durations = useMemo(() => {
    const values = new Set<number>(DURATION_PRESETS);
    values.add(order.duration_minutes);
    return [...values].sort((a, b) => a - b);
  }, [order.duration_minutes]);

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

          <DetailRow label="الزبونة">
            {order.customer_name ?? "—"} · <span dir="ltr">{order.customer_phone}</span>
          </DetailRow>

          <Separator />

          <FieldGroup>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor={`date-${order.id}`}>يوم الموعد</FieldLabel>
                <Input
                  id={`date-${order.id}`}
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="min-h-11"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`time-${order.id}`}>وقت الوصول</FieldLabel>
                <Input
                  id={`time-${order.id}`}
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="min-h-11"
                />
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor={`location-${order.id}`}>موقع الزبونة</FieldLabel>
              <Input
                id={`location-${order.id}`}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="الرابط أو العنوان"
                className="min-h-11"
              />
            </Field>

            <Field>
              <FieldLabel>مدة الجلسة</FieldLabel>
              <ToggleGroup
                type="single"
                value={duration}
                onValueChange={(value) => value && setDuration(value)}
                variant="outline"
                spacing={1}
                className="flex-wrap"
                aria-label="مدة الجلسة"
              >
                {durations.map((minutes) => (
                  <ToggleGroupItem key={minutes} value={String(minutes)} className="min-h-10">
                    {minutes} د
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Field>

            <Field>
              <FieldLabel>نوع الرحلة</FieldLabel>
              <ToggleGroup
                type="single"
                value={tripType}
                onValueChange={(value) => value && setTripType(value as TripType)}
                variant="outline"
                spacing={1}
                className="w-full"
                aria-label="نوع الرحلة"
              >
                <ToggleGroupItem value="one_way" className="min-h-10 flex-1">
                  ذهاب فقط
                </ToggleGroupItem>
                <ToggleGroupItem value="round_trip" className="min-h-10 flex-1">
                  ذهاب وعودة
                </ToggleGroupItem>
              </ToggleGroup>
            </Field>

            <Field>
              <FieldLabel htmlFor={`specialist-${order.id}`}>الأخصائية</FieldLabel>
              <Select
                value={specialistId || "none"}
                onValueChange={(value) => setSpecialistId(value === "none" ? "" : value)}
              >
                <SelectTrigger id={`specialist-${order.id}`} className="min-h-11 w-full">
                  <SelectValue placeholder="لم تُحدد" />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectGroup>
                    <SelectItem value="none">لم تُحدد</SelectItem>
                    {specialists.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.full_name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor={`driver-${order.id}`}>السائق</FieldLabel>
              <Select
                value={driverId || "none"}
                onValueChange={(value) => setDriverId(value === "none" ? "" : value)}
              >
                <SelectTrigger id={`driver-${order.id}`} className="min-h-11 w-full">
                  <SelectValue placeholder="لم يُحدد" />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectGroup>
                    <SelectItem value="none">لم يُحدد</SelectItem>
                    {drivers.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.full_name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {order.driver_phone ? (
                <FieldDescription dir="ltr" className="text-start">
                  {order.driver_phone}
                </FieldDescription>
              ) : null}
            </Field>

            {isAdmin ? (
              <Field>
                <FieldLabel htmlFor={`price-${order.id}`}>أجرة السائق</FieldLabel>
                <Input
                  id={`price-${order.id}`}
                  type="number"
                  min={0}
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="بالريال"
                  className="min-h-11"
                />
              </Field>
            ) : null}

            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>

          {order.status === "sent" && dirty ? (
            <Alert>
              <AlertTriangle />
              <AlertDescription>
                هذا الطلب وصل السائق بالفعل — بعد الحفظ أعيدي الإرسال ليصله التحديث.
              </AlertDescription>
            </Alert>
          ) : null}
          {saved && !dirty ? (
            <Alert>
              <CheckCircle2 />
              <AlertDescription>حُفظ التعديل.</AlertDescription>
            </Alert>
          ) : null}

          <Button onClick={save} disabled={saving || !dirty}>
            {saving ? <Spinner data-icon="inline-start" /> : null}
            {saving ? "جارٍ الحفظ…" : "حفظ التعديل"}
          </Button>

          <Separator />
          <p className="text-xs text-muted-foreground">
            أُنشئ {formatRelativeTime(order.created_at)}
            {order.sent_at ? ` · أُرسل ${formatRelativeTime(order.sent_at)}` : ""}
          </p>
          <EditedLine order={order} className="-mt-2 text-xs text-muted-foreground" />
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * "عُدّل بواسطة سارة · قبل ساعة" — only once an edit has actually happened.
 * `updated_at` starts life equal to `created_at`, and rows edited before the
 * `updated_by` column existed have no author to name.
 */
function EditedLine({
  order,
  className,
}: {
  order: DriverOrderRow;
  className?: string;
}) {
  const editedAt = order.updated_at;
  if (!editedAt) return null;
  const changed =
    new Date(editedAt).getTime() - new Date(order.created_at).getTime() > 1000;
  if (!changed) return null;
  return (
    <p className={className}>
      عُدّل بواسطة {order.updated_by_name ?? "أحد الموظفين"} ·{" "}
      {formatRelativeTime(editedAt)}
    </p>
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
  // Some instructions are faster said than typed, and a specialist who reads
  // little Arabic follows a voice better than a translation.
  const [noteMode, setNoteMode] = useState<NoteMode>("text");
  const [voiceNote, setVoiceNote] = useState<VoiceNote | null>(null);
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
    setNoteMode("text");
    setVoiceNote((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
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
      // A recording has to go up as multipart; a written note stays JSON.
      const voiceFile = noteMode === "voice" ? voiceNote?.file : null;
      let body: BodyInit;
      let headers: HeadersInit | undefined;
      if (voiceFile) {
        const form = new FormData();
        form.append("specialistId", specialistId);
        form.append("driverId", driverId);
        form.append("specialistVoice", voiceFile, voiceFile.name);
        body = form;
      } else {
        headers = { "Content-Type": "application/json" };
        body = JSON.stringify({
          specialistId,
          driverId,
          specialistNote: noteMode === "text" ? specialistNote : "",
        });
      }
      const response = await fetch(`/api/orders/${order.id}/dispatch`, {
        method: "POST",
        headers,
        body,
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
  }, [
    confirmed,
    driverId,
    noteMode,
    onUpdated,
    order.id,
    specialistId,
    specialistNote,
    voiceNote,
  ]);

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
                  <FieldLabel>رسالة للأخصائية</FieldLabel>
                  <ToggleGroup
                    type="single"
                    value={noteMode}
                    onValueChange={(value) => value && setNoteMode(value as NoteMode)}
                    variant="outline"
                    spacing={1}
                    className="w-full"
                    aria-label="نوع الرسالة"
                  >
                    <ToggleGroupItem value="text" className="min-h-10 flex-1">
                      <MessageSquareText data-icon="inline-start" />
                      مكتوبة
                    </ToggleGroupItem>
                    <ToggleGroupItem value="voice" className="min-h-10 flex-1">
                      <Mic data-icon="inline-start" />
                      صوتية
                    </ToggleGroupItem>
                  </ToggleGroup>

                  {noteMode === "text" ? (
                    <>
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
                    </>
                  ) : (
                    <VoiceNoteRecorder
                      value={voiceNote}
                      onChange={setVoiceNote}
                      disabled={submitting}
                      description={`تفاصيل الحجز تُرسل مكتوبة ومترجمة إلى ${language}، ويصلها تسجيلك بصوتك بعدها.`}
                    />
                  )}
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
