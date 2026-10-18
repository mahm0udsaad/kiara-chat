"use client";

import { useMemo, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  RefreshCw,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import type { DriverStep, DriverStepSummary } from "@/lib/driver-steps";
import type {
  OperationsEvent,
  OperationsReport,
  OperationsRole,
} from "@/lib/operations-report";

const roleLabels: Record<OperationsRole, string> = {
  specialist: "الأخصائيات",
  driver: "السائقون",
};

const REPORT_LOCALE = "en-US-u-ca-gregory-nu-latn";
const numberFormatter = new Intl.NumberFormat(REPORT_LOCALE);
const decimalFormatter = new Intl.NumberFormat(REPORT_LOCALE, { maximumFractionDigits: 1 });
const dateFormatter = new Intl.DateTimeFormat(REPORT_LOCALE, {
  timeZone: "Asia/Riyadh",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const timeFormatter = new Intl.DateTimeFormat(REPORT_LOCALE, {
  timeZone: "Asia/Riyadh",
  hour: "numeric",
  minute: "2-digit",
});
const shortDateFormatter = new Intl.DateTimeFormat(REPORT_LOCALE, {
  timeZone: "Asia/Riyadh",
  weekday: "short",
  day: "numeric",
  month: "short",
});

const toMinutes = (time: string) => {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
};

function eventMinute(iso: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Riyadh",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  return (
    Number(parts.find((part) => part.type === "hour")?.value ?? 0) * 60 +
    Number(parts.find((part) => part.type === "minute")?.value ?? 0)
  );
}

function eventDay(iso: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function layoutEvents(events: OperationsEvent[]) {
  const sorted = [...events].sort((a, b) => a.arrivalAt.localeCompare(b.arrivalAt));
  const result: Array<{ event: OperationsEvent; lane: number; lanes: number }> = [];
  let cluster: OperationsEvent[] = [];
  let clusterEnd = -1;

  const flush = () => {
    if (!cluster.length) return;
    const laneEnds: number[] = [];
    const placed = cluster.map((event) => {
      const start = eventMinute(event.arrivalAt);
      const end = start + Math.max(event.durationMinutes, 1);
      let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = end;
      return { event, lane };
    });
    const lanes = Math.max(laneEnds.length, 1);
    result.push(...placed.map((item) => ({ ...item, lanes })));
    cluster = [];
    clusterEnd = -1;
  };

  for (const event of sorted) {
    const start = eventMinute(event.arrivalAt);
    const end = start + Math.max(event.durationMinutes, 1);
    if (cluster.length && start >= clusterEnd) flush();
    cluster.push(event);
    clusterEnd = Math.max(clusterEnd, end);
  }
  flush();
  return result;
}

function shiftDay(day: string, amount: number) {
  const value = new Date(`${day}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function hoursLabel(minutes: number) {
  return decimalFormatter.format(minutes / 60);
}

/**
 * A leg reads in minutes until that stops being legible. "١٣٥ د" makes the
 * owner do the division; past two hours she wants "٢.٣ س".
 */
function minutesLabel(minutes: number) {
  return minutes >= 120
    ? `${decimalFormatter.format(minutes / 60)} س`
    : `${numberFormatter.format(minutes)} د`;
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card size="sm">
      <CardContent className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</span>
        <span>
          <span className="block text-xs text-muted-foreground">{label}</span>
          <span className="block text-xl font-semibold tabular-nums">{value}</span>
        </span>
      </CardContent>
    </Card>
  );
}

/** "12 متأخر من 40 · المعتاد 24 د" for one arrival step over the range. */
function LatenessCell({ summary }: { summary: DriverStepSummary | undefined }) {
  if (!summary || !(summary.onTime + summary.late + summary.missing)) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className="tabular-nums">
      <span className={cn("font-medium", summary.late ? "text-destructive" : "text-emerald-700")}>
        {numberFormatter.format(summary.late)}
      </span>{" "}
      من {numberFormatter.format(summary.onTime + summary.late)}
      {summary.medianLateMinutes != null ? (
        <span className="block text-xs text-muted-foreground">
          المعتاد {minutesLabel(summary.medianLateMinutes)}
        </span>
      ) : null}
      {summary.missing ? (
        <span className="block text-xs text-muted-foreground">
          {numberFormatter.format(summary.missing)} لم يُسجَّل
        </span>
      ) : null}
    </span>
  );
}

/** One arrival confirmation: when it was due, when he tapped it, the verdict. */
function StepCell({ step }: { step: DriverStep | undefined }) {
  if (!step) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="tabular-nums">
      {step.status === "late" ? (
        <Badge variant="destructive">متأخر {minutesLabel(step.lateMinutes ?? 0)}</Badge>
      ) : step.status === "on_time" ? (
        <Badge variant="secondary">في الموعد</Badge>
      ) : (
        <Badge variant="outline">{step.status === "missing" ? "لم يُسجَّل" : "لم يحن موعده"}</Badge>
      )}
      <span className="mt-1 block text-xs text-muted-foreground">
        المطلوب {timeFormatter.format(new Date(step.dueAt))}
        {step.at ? ` · ضغط ${timeFormatter.format(new Date(step.at))}` : ""}
      </span>
    </span>
  );
}

type DriverTripFilter = "all" | "open" | "late_specialist" | "late_client" | "done";

function matchesTripFilter(event: OperationsEvent, filter: DriverTripFilter) {
  if (filter === "open") return !event.completed;
  if (filter === "done") return event.completed;
  if (filter === "late_specialist") return event.driverSteps?.specialist.status === "late";
  if (filter === "late_client") return event.driverSteps?.client.status === "late";
  return true;
}

/**
 * One driver's trips over the range as a plain log: which he had, which he
 * finished, and how «وصلت للأخصائية» and «وصلت للعميلة» compared with their
 * times.
 */
function DriverTrips({ report }: { report: OperationsReport }) {
  const drivers = report.people.driver.filter((person) => person.assignedCount > 0);
  const [selectedId, setSelectedId] = useState("");
  const [filter, setFilter] = useState<DriverTripFilter>("all");
  const driver = drivers.find((person) => person.id === selectedId) ?? drivers[0];
  if (!driver) return null;

  const trips = report.events.driver
    .filter((event) => event.personIds.includes(driver.id))
    .sort((a, b) => b.arrivalAt.localeCompare(a.arrivalAt));
  const count = (value: DriverTripFilter) =>
    trips.filter((event) => matchesTripFilter(event, value)).length;
  const filters: [DriverTripFilter, string][] = [
    ["all", "الكل"],
    ["open", "لم تكتمل"],
    ["late_specialist", "تأخر عند الأخصائية"],
    ["late_client", "تأخر عند العميلة"],
    ["done", "مكتملة"],
  ];
  const shown = trips.filter((event) => matchesTripFilter(event, filter));
  const rules = report.driverStepRules;

  return (
    <Card>
      <CardHeader>
        <CardTitle>سجل مشاوير السائق</CardTitle>
        <CardDescription>
          تأخير السائق: وصوله للعميلة بعد وقت الحجز ولو بدقيقة. وعند الأخصائية قبل موعد العميلة بـ{" "}
          {numberFormatter.format(rules.specialistLeadMinutes)} دقيقة مع سماح{" "}
          {numberFormatter.format(rules.graceMinutes)} دقائق، للاطلاع فقط.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <Select value={driver.id} onValueChange={(value) => value && setSelectedId(value)}>
            <SelectTrigger aria-label="السائق" className="min-h-11 w-full lg:w-64">
              <SelectValue>{driver.name}</SelectValue>
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectGroup>
                {drivers.map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    {person.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <ToggleGroup
            type="single"
            value={filter}
            onValueChange={(value) => value && setFilter(value as DriverTripFilter)}
            variant="outline"
            spacing={0}
            aria-label="تصفية المشاوير"
            className="flex-wrap"
          >
            {filters.map(([value, label]) => (
              <ToggleGroupItem key={value} value={value} aria-label={label}>
                {label} <span className="tabular-nums opacity-70">{numberFormatter.format(count(value))}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        {shown.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>موعد العميلة</TableHead>
                <TableHead>العميلة</TableHead>
                <TableHead className="text-center">الحالة</TableHead>
                <TableHead>وصلت للأخصائية</TableHead>
                <TableHead>وصلت للعميلة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((event) => (
                <TableRow key={event.id}>
                  <TableCell className="tabular-nums">
                    {shortDateFormatter.format(new Date(event.arrivalAt))}
                    <span className="block text-xs text-muted-foreground">
                      {timeFormatter.format(new Date(event.arrivalAt))}
                    </span>
                  </TableCell>
                  <TableCell className="font-medium">
                    {event.customerName || event.customerPhone}
                    {event.driverLeg === "return" ? (
                      <span className="block text-xs font-normal text-muted-foreground">مشوار عودة</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-center">
                    {event.completed ? (
                      <Badge variant="secondary">مكتمل</Badge>
                    ) : (
                      <Badge variant="outline">لم يكتمل</Badge>
                    )}
                  </TableCell>
                  <TableCell><StepCell step={event.driverSteps?.specialist} /></TableCell>
                  <TableCell><StepCell step={event.driverSteps?.client} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            لا توجد مشاوير بهذا التصنيف خلال الفترة المختارة.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Timeline({ report, role, selectedDay }: { report: OperationsReport; role: OperationsRole; selectedDay: string }) {
  const people = report.people[role].filter((person) => person.isActive || person.assignedCount > 0);
  const events = report.events[role].filter((event) => eventDay(event.arrivalAt) === selectedDay);
  const start = toMinutes(report.startTime);
  const end = toMinutes(report.endTime);
  // At 1px/minute, the 15-minute Rekaz services were only 15px high. The old
  // 40px minimum then made consecutive services physically overlap. A larger
  // scale lets every card keep its true duration and remain legible.
  const pixelsPerMinute = 1.5;
  const height = Math.max((end - start) * pixelsPerMinute, 240);
  const hourRows = Array.from(
    { length: Math.ceil((end - start) / 60) + 1 },
    (_, index) => start + index * 60,
  ).filter((minute) => minute <= end);

  if (!people.length) {
    return <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">لا يوجد أفراد في هذا الفريق بعد.</div>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border bg-card" dir="rtl">
      <div
        className="grid min-w-max"
        style={{ gridTemplateColumns: `82px repeat(${people.length}, minmax(280px, 1fr))` }}
      >
        <div className="sticky right-0 z-30 border-l bg-card p-3" />
        {people.map((person) => (
          <div key={person.id} className="sticky top-0 z-20 border-l bg-card px-4 py-3 text-center">
            <div className="mx-auto mb-1 flex size-9 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary">
              {person.name.slice(0, 2)}
            </div>
            <p className="max-w-[220px] truncate text-base font-semibold">{person.name}</p>
            <p className="text-xs text-muted-foreground">
              {numberFormatter.format(person.assignedCount)} مسند · {hoursLabel(person.scheduledMinutes)} س
            </p>
          </div>
        ))}

        <div className="sticky right-0 z-20 border-l bg-card" style={{ height }}>
          {hourRows.map((minute) => (
            <span
              key={minute}
              className="absolute left-2 right-0 -translate-y-1/2 text-left text-xs tabular-nums text-muted-foreground"
              style={{ top: (minute - start) * pixelsPerMinute }}
            >
              {String(Math.floor(minute / 60)).padStart(2, "0")}:00
            </span>
          ))}
        </div>

        {people.map((person) => {
          const assigned = layoutEvents(events.filter((event) => event.personIds.includes(person.id)));
          return (
            <div key={person.id} className="relative border-l bg-background/40" style={{ height }}>
              {hourRows.map((minute) => (
                <div
                  key={minute}
                  className="absolute inset-x-0 border-t border-border/70"
                  style={{ top: (minute - start) * pixelsPerMinute }}
                />
              ))}
              {assigned.map(({ event, lane, lanes }) => {
                const eventStart = Math.max(eventMinute(event.arrivalAt), start);
                const eventEnd = Math.min(eventMinute(event.arrivalAt) + event.durationMinutes, end);
                const top = (eventStart - start) * pixelsPerMinute;
                const eventHeight = Math.max((eventEnd - eventStart) * pixelsPerMinute, 18);
                const compact = eventHeight < 42;
                const medium = eventHeight >= 42 && eventHeight < 70;
                const laneWidth = 100 / lanes;
                return (
                  <article
                    key={`${event.id}:${person.id}`}
                    className={cn(
                      "absolute z-10 overflow-hidden rounded-lg border text-xs leading-4 shadow-sm",
                      compact ? "px-1.5 py-0.5" : "p-2",
                      event.completed
                        ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                        : event.source === "rekaz"
                          ? "border-primary/20 bg-primary/10 text-foreground"
                          : "border-amber-200 bg-amber-50 text-amber-950",
                    )}
                    style={{
                      top,
                      height: eventHeight,
                      width: `calc(${laneWidth}% - 6px)`,
                      right: `calc(${lane * laneWidth}% + 3px)`,
                    }}
                    title={`${event.customerName || event.customerPhone} — ${event.service}`}
                  >
                    {compact ? (
                      <p className="truncate font-semibold">
                        {timeFormatter.format(new Date(event.arrivalAt))} · {event.service}
                      </p>
                    ) : (
                      <>
                        <div className="flex items-center justify-between gap-2 font-semibold">
                          <span className="truncate">{timeFormatter.format(new Date(event.arrivalAt))}</span>
                          {event.completed ? <CheckCircle2 className="size-3.5 shrink-0" aria-label="مكتمل" /> : null}
                        </div>
                        <p className="truncate font-medium">{event.customerName || event.customerPhone}</p>
                        {!medium ? <p className="truncate opacity-75">{event.service}</p> : null}
                      </>
                    )}
                  </article>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function OperationsReportClient({ initialReport }: { initialReport: OperationsReport }) {
  const [report, setReport] = useState(initialReport);
  const [role, setRole] = useState<OperationsRole>("specialist");
  const [from, setFrom] = useState(initialReport.from);
  const [to, setTo] = useState(initialReport.to);
  const [startTime, setStartTime] = useState(initialReport.startTime);
  const [endTime, setEndTime] = useState(initialReport.endTime);
  const [selectedDay, setSelectedDay] = useState(initialReport.from);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const people = report.people[role];
  const totals = useMemo(
    () => people.reduce(
      (sum, person) => ({
        assigned: sum.assigned + person.assignedCount,
        completed: sum.completed + person.completedCount,
        minutes: sum.minutes + person.scheduledMinutes,
      }),
      { assigned: 0, completed: 0, minutes: 0 },
    ),
    [people],
  );

  async function applyFilters() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from, to, startTime, endTime });
      const response = await fetch(`/api/reports/operations?${params}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "تعذّر تحميل التقرير");
      setReport(body as OperationsReport);
      if (selectedDay < from || selectedDay > to) setSelectedDay(from);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذّر تحميل التقرير");
    } finally {
      setLoading(false);
    }
  }

  const canPrevious = selectedDay > report.from;
  const canNext = selectedDay < report.to;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>نطاق التقرير</CardTitle>
          <CardDescription>التوقيت المعروض هو توقيت الرياض. الحد الأقصى 31 يوماً.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_0.8fr_0.8fr_auto]">
          <label className="space-y-1 text-xs text-muted-foreground">
            من تاريخ
            <Input aria-label="من تاريخ" dir="ltr" lang="en-US" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            إلى تاريخ
            <Input aria-label="إلى تاريخ" dir="ltr" lang="en-US" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            من الساعة
            <Input aria-label="من الساعة" dir="ltr" lang="en-US" type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            إلى الساعة
            <Input aria-label="إلى الساعة" dir="ltr" lang="en-US" type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} />
          </label>
          <Button className="self-end" onClick={() => void applyFilters()} disabled={loading || !from || !to}>
            <RefreshCw className={cn(loading && "animate-spin")} />
            {loading ? "جارٍ التحديث" : "تطبيق"}
          </Button>
        </CardContent>
      </Card>

      {error ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}

      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <ToggleGroup
          type="single"
          value={role}
          onValueChange={(value) => value && setRole(value as OperationsRole)}
          variant="outline"
          spacing={0}
          aria-label="الفريق المعروض"
        >
          <ToggleGroupItem value="specialist" aria-label="الأخصائيات">الأخصائيات</ToggleGroupItem>
          <ToggleGroupItem value="driver" aria-label="السائقون">السائقون</ToggleGroupItem>
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">يشمل حجوزات ركاز وطلبات واتساب دون تكرار الزيارة.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric icon={<Users className="size-4" />} label="الطلبات المسندة" value={numberFormatter.format(totals.assigned)} />
        <Metric icon={<CheckCircle2 className="size-4" />} label="الطلبات المكتملة" value={numberFormatter.format(totals.completed)} />
        <Metric icon={<Clock3 className="size-4" />} label="الساعات المحجوزة" value={`${hoursLabel(totals.minutes)} س`} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>مسؤولية التأخير</CardTitle>
          <CardDescription>التصنيف مبني على الخطة، نطاقات الموقع، وحد السماح؛ الأدلة الناقصة تبقى غير مؤكدة.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <Metric icon={<CheckCircle2 />} label="في الموعد" value={numberFormatter.format(report.punctuality.onTime)} />
          <Metric icon={<Clock3 />} label="السائق إلى الأخصائية" value={numberFormatter.format(report.punctuality.driverLateToSpecialist)} />
          <Metric icon={<Clock3 />} label="انتظار الأخصائية" value={numberFormatter.format(report.punctuality.specialistDelayedDeparture)} />
          <Metric icon={<Clock3 />} label="الرحلة إلى العميلة" value={numberFormatter.format(report.punctuality.driverTripLateToClient)} />
          <Metric icon={<RefreshCw />} label="غير مؤكد" value={numberFormatter.format(report.punctuality.uncertain)} />
          <Metric icon={<RefreshCw />} label="ينقصه سبب" value={numberFormatter.format(report.punctuality.missingReason)} />
        </CardContent>
      </Card>

      {/* Not split by role: a leg belongs to the hand-off between the two, and
          attributing "من الركوب حتى بدء الخدمة" to one of them would invite the
          wrong argument about whose fault it is. */}
      {report.timings.length ? (
        <Card>
          <CardHeader>
            <CardTitle>توقيت خطوات الزيارة</CardTitle>
            <CardDescription>
              متوسط الوقت بين كل خطوة والتي تليها، محسوباً من تأكيدات الفريق في
              التطبيق. تُحتسب الزيارة في مرحلة ما فقط إذا أُكِّد طرفاها.
            </CardDescription>
          </CardHeader>
          <CardContent className="pb-0">
            {/* Says how much of the trail above can actually be trusted: a
                timing is only as good as the confirmation it came from. */}
            <p className="text-xs text-muted-foreground">
              توثيق الموقع:{" "}
              {numberFormatter.format(report.locationEvidence.verifiedPercent)}% من
              الخطوات المؤكدة سُجّل معها موقع فعلي (
              {numberFormatter.format(report.locationEvidence.verifiedSteps)} خطوة).
              {report.locationEvidence.exceptionSteps
                ? ` ${numberFormatter.format(report.locationEvidence.exceptionSteps)} بعذر مكتوب.`
                : ""}
              {report.locationEvidence.unrecordedSteps
                ? ` ${numberFormatter.format(report.locationEvidence.unrecordedSteps)} بلا تسجيل — غالباً من إصدار قديم للتطبيق.`
                : ""}
            </p>
          </CardContent>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المرحلة</TableHead>
                  <TableHead className="text-center">المتوسط</TableHead>
                  <TableHead className="text-center">الأطول</TableHead>
                  <TableHead className="text-center">عدد الزيارات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.timings.map((leg) => (
                  <TableRow key={leg.key}>
                    <TableCell className="font-medium">{leg.label}</TableCell>
                    <TableCell className="text-center tabular-nums">
                      {minutesLabel(leg.averageMinutes)}
                    </TableCell>
                    <TableCell className="text-center tabular-nums text-muted-foreground">
                      {minutesLabel(leg.slowestMinutes)}
                    </TableCell>
                    <TableCell className="text-center tabular-nums text-muted-foreground">
                      {numberFormatter.format(leg.sampleCount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>ملخص {roleLabels[role]}</CardTitle>
          <CardDescription>الطلب متعدد الخدمات يُحسب زيارة واحدة، بينما الساعات تجمع مدة كل خدمة فعلية.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الاسم</TableHead>
                <TableHead className="text-center">مسند</TableHead>
                <TableHead className="text-center">مكتمل</TableHead>
                <TableHead className="text-center">نسبة الإنجاز</TableHead>
                <TableHead className="text-center">الساعات</TableHead>
                {role === "driver" ? (
                  <>
                    <TableHead className="text-center">تأخر عند الأخصائية</TableHead>
                    <TableHead className="text-center">تأخر عند العميلة</TableHead>
                  </>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {people.map((person) => (
                <TableRow key={person.id}>
                  <TableCell className="font-medium">
                    {person.name}
                    {person.source === "rekaz" ? <Badge variant="secondary" className="mr-2">ركاز</Badge> : null}
                    {!person.isActive ? <Badge variant="outline" className="mr-2">موقوف</Badge> : null}
                  </TableCell>
                  <TableCell className="text-center tabular-nums">{numberFormatter.format(person.assignedCount)}</TableCell>
                  <TableCell className="text-center tabular-nums">{numberFormatter.format(person.completedCount)}</TableCell>
                  <TableCell className="text-center tabular-nums">
                    {person.assignedCount ? numberFormatter.format(Math.round((person.completedCount / person.assignedCount) * 100)) : "0"}%
                  </TableCell>
                  <TableCell className="text-center tabular-nums">{hoursLabel(person.scheduledMinutes)} س</TableCell>
                  {role === "driver" ? (
                    <>
                      <TableCell className="text-center"><LatenessCell summary={person.lateness?.specialist} /></TableCell>
                      <TableCell className="text-center"><LatenessCell summary={person.lateness?.client} /></TableCell>
                    </>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {role === "driver" ? <DriverTrips report={report} /> : null}

      <Card>
        <CardHeader className="gap-3 sm:grid-cols-[1fr_auto]">
          <div>
            <CardTitle>جدول الحجوزات والطلبات</CardTitle>
            <CardDescription>{dateFormatter.format(new Date(`${selectedDay}T12:00:00+03:00`))}</CardDescription>
          </div>
          <div className="flex items-center gap-2" dir="ltr">
            <Button variant="outline" size="icon" aria-label="اليوم السابق" disabled={!canPrevious} onClick={() => setSelectedDay(shiftDay(selectedDay, -1))}>
              <ChevronLeft />
            </Button>
            <Button variant="outline" onClick={() => setSelectedDay(report.from)}>
              <CalendarDays /> أول يوم
            </Button>
            <Button variant="outline" size="icon" aria-label="اليوم التالي" disabled={!canNext} onClick={() => setSelectedDay(shiftDay(selectedDay, 1))}>
              <ChevronRight />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Timeline report={report} role={role} selectedDay={selectedDay} />
        </CardContent>
      </Card>
    </div>
  );
}
