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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
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
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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
