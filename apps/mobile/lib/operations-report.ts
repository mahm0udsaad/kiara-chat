import { addDays, dayKeyFromToday, dayKeyOf } from "@/lib/calendar";
import type { OperationsEvent, OperationsRole } from "@/types/api";

export type ReportPeriod = "today" | "month" | "week";

/** Reports keep Arabic labels but use Gregorian dates and Latin digits. */
export const REPORT_LOCALE = "en-US-u-ca-gregory-nu-latn";
export const reportInteger = new Intl.NumberFormat(REPORT_LOCALE);
export const reportDecimal = new Intl.NumberFormat(REPORT_LOCALE, {
  maximumFractionDigits: 1,
});

export type VisitService = {
  name: string;
  count: number;
  durationMinutes: number;
};

export type OperationsVisit = {
  key: string;
  orderId: string | null;
  arrivalAt: string;
  endsAt: string;
  customerName: string;
  customerPhone: string;
  services: VisitService[];
  serviceCount: number;
  serviceMinutes: number;
  spanMinutes: number;
  completed: boolean;
  completedAt: string | null;
  sourceLabel: string;
};

/** Current Saudi working week (Sunday–Saturday) or current calendar month. */
export function reportRange(period: ReportPeriod, today = dayKeyFromToday(0)) {
  if (period === "today") return { from: today, to: today };
  if (period === "week") {
    const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
    const from = addDays(today, -weekday);
    return { from, to: addDays(from, 6) };
  }
  const [year = new Date().getUTCFullYear(), month = 1] = today.split("-").map(Number);
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from, to: `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}` };
}

/**
 * Rekaz returns one row per service. A client booking three services is one
 * visit, not three duplicate orders, so the mobile timeline groups on the
 * server's stable visit key and keeps the services inside that visit card.
 */
export function groupOperationsVisits(events: OperationsEvent[]): OperationsVisit[] {
  const grouped = new Map<string, OperationsEvent[]>();
  for (const event of events) {
    const bucket = grouped.get(event.visitKey) ?? [];
    bucket.push(event);
    grouped.set(event.visitKey, bucket);
  }

  return [...grouped.entries()]
    .map(([key, unordered]) => {
      const rows = [...unordered].sort((a, b) => a.arrivalAt.localeCompare(b.arrivalAt));
      const first = rows[0]!;
      const starts = rows.map((event) => new Date(event.arrivalAt).getTime());
      const ends = rows.map((event) => new Date(event.endsAt).getTime());
      const serviceMap = new Map<string, VisitService>();
      for (const event of rows) {
        const name = event.service.trim() || "خدمة";
        const existing = serviceMap.get(name);
        if (existing) {
          existing.count += 1;
          existing.durationMinutes += event.durationMinutes;
        } else {
          serviceMap.set(name, { name, count: 1, durationMinutes: event.durationMinutes });
        }
      }
      const start = Math.min(...starts);
      const end = Math.max(...ends);
      return {
        key,
        orderId: rows.find((event) => event.orderId)?.orderId ?? null,
        arrivalAt: new Date(start).toISOString(),
        endsAt: new Date(end).toISOString(),
        customerName: first.customerName,
        customerPhone: first.customerPhone,
        services: [...serviceMap.values()],
        serviceCount: rows.length,
        serviceMinutes: rows.reduce((total, event) => total + event.durationMinutes, 0),
        spanMinutes: Math.max(0, Math.round((end - start) / 60_000)),
        completed: rows.every((event) => event.completed),
        completedAt: rows.find((event) => event.completedAt)?.completedAt ?? null,
        sourceLabel: rows.some((event) => event.source === "rekaz") ? "حجز ركاز" : "طلب واتساب",
      };
    })
    .sort((a, b) => b.arrivalAt.localeCompare(a.arrivalAt));
}

export function visitsByDay(visits: OperationsVisit[]) {
  const groups = new Map<string, OperationsVisit[]>();
  for (const visit of visits) {
    const day = dayKeyOf(visit.arrivalAt);
    const bucket = groups.get(day) ?? [];
    bucket.push(visit);
    groups.set(day, bucket);
  }
  return [...groups.entries()].sort(([a], [b]) => b.localeCompare(a));
}

export function completedWorkLabel(role: OperationsRole) {
  return role === "specialist" ? "الخدمات المكتملة" : "الطلبات المكتملة";
}
