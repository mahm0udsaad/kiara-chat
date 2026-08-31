"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CalendarCheck2,
  Car,
  Lightbulb,
  MapPin,
  MessageSquare,
  MessageSquareHeart,
  MessageSquareText,
  Sparkles,
  StickyNote,
  ThumbsUp,
  UserRound,
  Wallet,
} from "lucide-react";
import { ConversationAuditPanel } from "@/components/audit-trail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { CustomerTimeline, TimelineEvent } from "@/lib/customer-timeline";
import type { CustomerAnalysisResult } from "@/lib/customer-analysis";

const TZ = "Asia/Riyadh";
const DAY_FMT = new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
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

const riyal = (v: number) => `${v.toLocaleString("ar-SA")} ر.س`;

const STATUS_LABEL: Record<string, string> = {
  Confirmed: "مؤكد",
  Pending: "غير مؤكد",
  Done: "مكتمل",
  Cancelled: "ملغي",
};
const PAYMENT_LABEL: Record<string, string> = {
  Paid: "مدفوع",
  PartiallyPaid: "مدفوع جزئيًا",
  Pending: "بانتظار الدفع",
};
const DRIVER_STATUS_LABEL: Record<string, string> = {
  sent: "سائق مُرسل",
  pending: "طلب سائق (لم يُرسل)",
  failed: "فشل إرسال السائق",
};
const TRIP_LABEL: Record<string, string> = {
  one_way: "ذهاب فقط",
  round_trip: "ذهاب وعودة",
};

/**
 * One customer, everything in one place.
 *
 * A slide-over opened from the reservations table. It fetches the merged
 * timeline on open — Rekaz bookings + payments stitched with the WhatsApp
 * thread, driver trips and staff notes, keyed on phone — and renders a
 * lifetime-revenue header above a chronological feed. Read-only: the deep
 * actions (reply, dispatch) live where they already do, one click away.
 */
export function CustomerTimelineSheet({
  phone,
  name,
  open,
  isAdmin = false,
  onClose,
}: {
  phone: string | null;
  name?: string | null;
  open: boolean;
  /** Gates the responsibility trail — the endpoint refuses everyone else. */
  isAdmin?: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<CustomerTimeline | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<CustomerAnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const runAnalysis = () => {
    if (!phone || analyzing) return;
    setAnalyzing(true);
    setAnalysisError(null);
    fetch(`/api/customers/${encodeURIComponent(phone)}/analysis`, { method: "POST" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error ?? "تعذّر التحليل");
        return body as CustomerAnalysisResult;
      })
      .then(setAnalysis)
      .catch((e) => setAnalysisError(e instanceof Error ? e.message : "تعذّر التحليل"))
      .finally(() => setAnalyzing(false));
  };

  useEffect(() => {
    if (!open || !phone) return;
    let cancelled = false;
    // Deferred a tick so the reset + load state don't cascade a render inside
    // the effect body (matches the inbox's deep-link pattern).
    const timer = window.setTimeout(() => {
      setData(null);
      setError(null);
      setLoading(true);
      // A fresh customer starts with no analysis — it's on-demand per person.
      setAnalysis(null);
      setAnalysisError(null);
      setAnalyzing(false);
      fetch(`/api/customers/${encodeURIComponent(phone)}/timeline`)
        .then(async (res) => {
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body?.error ?? "تعذّر التحميل");
          return body as CustomerTimeline;
        })
        .then((body) => {
          if (!cancelled) setData(body);
        })
        .catch((e) => {
          if (!cancelled) setError(e instanceof Error ? e.message : "تعذّر التحميل");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, phone]);

  const headerName = data?.customer.name ?? name ?? null;

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="left"
        className="w-full gap-0 sm:max-w-lg"
        aria-describedby={undefined}
      >
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-2">
            <UserRound size={18} aria-hidden="true" />
            {headerName || "زبونة"}
          </SheetTitle>
          <SheetDescription dir="ltr" className="text-start">
            {phone}
          </SheetDescription>
          {data?.customer.labels.length ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {data.customer.labels.map((l) => (
                <Badge key={l.name} variant="outline" className="text-[11px]">
                  {l.name}
                </Badge>
              ))}
            </div>
          ) : null}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Spinner />
            </div>
          ) : error ? (
            <p className="p-4 text-sm text-rose-700">{error}</p>
          ) : data ? (
            <TimelineBody
              data={data}
              isAdmin={isAdmin}
              analysis={analysis}
              analyzing={analyzing}
              analysisError={analysisError}
              onAnalyze={runAnalysis}
            />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function TimelineBody({
  data,
  isAdmin,
  analysis,
  analyzing,
  analysisError,
  onAnalyze,
}: {
  data: CustomerTimeline;
  isAdmin: boolean;
  analysis: CustomerAnalysisResult | null;
  analyzing: boolean;
  analysisError: string | null;
  onAnalyze: () => void;
}) {
  const { revenue, customer } = data;
  return (
    <div className="space-y-4 p-4">
      {/* Lifetime revenue — the headline the salon asked for. */}
      <div className="grid grid-cols-2 gap-2">
        <Stat
          icon={<Wallet size={14} aria-hidden="true" />}
          label="إجمالي الإنفاق"
          value={riyal(revenue.net)}
          hint={
            revenue.refunded > 0 ? `بعد استرجاع ${riyal(revenue.refunded)}` : undefined
          }
          tone="good"
        />
        <Stat
          icon={<CalendarCheck2 size={14} aria-hidden="true" />}
          label="الحجوزات"
          value={revenue.bookings.toLocaleString("ar-SA")}
          hint={
            revenue.cancelled > 0
              ? `منها ${revenue.cancelled.toLocaleString("ar-SA")} ملغي`
              : `${revenue.orders.toLocaleString("ar-SA")} طلب`
          }
        />
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        {customer.firstContactAt ? (
          <Meta label="أول تواصل" value={DAY_FMT.format(new Date(customer.firstContactAt))} />
        ) : null}
        {data.rekazError ? (
          <p className="col-span-2 rounded-lg bg-amber-50 px-2 py-1 text-amber-800">
            تعذّر جلب حجوزات ركاز الآن — تُعرض بيانات المحادثة فقط.
          </p>
        ) : null}
      </dl>

      {customer.conversationId ? (
        <Button asChild variant="outline" size="sm" className="w-full">
          <a href={`/inbox?c=${customer.conversationId}`}>
            <MessageSquareText data-icon="inline-start" />
            فتح المحادثة الكاملة
          </a>
        </Button>
      ) : null}

      <AnalysisSection
        analysis={analysis}
        analyzing={analyzing}
        error={analysisError}
        onAnalyze={onAnalyze}
      />

      {/* Who handled this customer, and what each of them did. Owner-only. */}
      {isAdmin && customer.conversationId ? (
        <ConversationAuditPanel conversationId={customer.conversationId} />
      ) : null}

      <Feed data={data} />
    </div>
  );
}

/** Score → tone, so a low satisfaction reads red at a glance. */
function scoreTone(score: number): { text: string; bar: string; ring: string } {
  if (score >= 75) return { text: "text-emerald-600", bar: "bg-emerald-500", ring: "ring-emerald-200" };
  if (score >= 50) return { text: "text-amber-600", bar: "bg-amber-500", ring: "ring-amber-200" };
  return { text: "text-rose-600", bar: "bg-rose-500", ring: "ring-rose-200" };
}

const TREND_LABEL: Record<string, string> = {
  improving: "في تحسّن",
  steady: "مستقر",
  declining: "في تراجع",
  unknown: "غير واضح",
};

function AnalysisSection({
  analysis,
  analyzing,
  error,
  onAnalyze,
}: {
  analysis: CustomerAnalysisResult | null;
  analyzing: boolean;
  error: string | null;
  onAnalyze: () => void;
}) {
  if (!analysis) {
    return (
      <div className="rounded-xl border border-dashed p-3">
        <div className="flex items-start gap-2">
          <MessageSquareHeart size={18} className="mt-0.5 shrink-0 text-[var(--brand)]" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">تحليل رضا العميلة</p>
            <p className="text-xs text-muted-foreground">
              قراءة ذكية للمحادثة: مدى رضاها، أسلوب تواصل الموظفات معها، وتوصيات للتحسين.
            </p>
          </div>
        </div>
        <Button size="sm" className="mt-2 w-full" onClick={onAnalyze} disabled={analyzing}>
          {analyzing ? (
            <>
              <Spinner data-icon="inline-start" />
              جارٍ التحليل…
            </>
          ) : (
            <>
              <Sparkles data-icon="inline-start" />
              حلّلي رضا العميلة
            </>
          )}
        </Button>
        {error ? <p className="mt-2 text-xs text-rose-700">{error}</p> : null}
      </div>
    );
  }

  const tone = scoreTone(analysis.satisfaction.score);
  return (
    <div className="space-y-3 rounded-xl border p-3">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex size-14 shrink-0 flex-col items-center justify-center rounded-full ring-4",
            tone.ring
          )}
        >
          <span className={cn("text-lg font-bold tabular-nums leading-none", tone.text)}>
            {analysis.satisfaction.score.toLocaleString("ar-SA")}
          </span>
          <span className="text-[9px] text-muted-foreground">من ١٠٠</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className={cn("text-sm font-semibold", tone.text)}>
              {analysis.satisfaction.label}
            </p>
            <Badge variant="outline" className="text-[10px]">
              {TREND_LABEL[analysis.trend] ?? analysis.trend}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">{analysis.satisfaction.summary}</p>
        </div>
      </div>

      {analysis.redFlags.length ? (
        <div className="rounded-lg bg-rose-50 p-2">
          <p className="flex items-center gap-1 text-xs font-medium text-rose-700">
            <AlertTriangle size={13} aria-hidden="true" />
            تحتاج انتباهًا
          </p>
          <ul className="mt-1 list-disc space-y-0.5 ps-4 text-xs text-rose-700">
            {analysis.redFlags.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <p className="flex items-center gap-1.5 text-xs font-medium">
          <ThumbsUp size={13} aria-hidden="true" />
          تواصل الموظفات
          <span className={cn("tabular-nums", scoreTone(analysis.staff.rating).text)}>
            {analysis.staff.rating.toLocaleString("ar-SA")}/١٠٠
          </span>
        </p>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full", scoreTone(analysis.staff.rating).bar)}
            style={{ width: `${analysis.staff.rating}%` }}
          />
        </div>
        {analysis.staff.strengths.length ? (
          <ul className="mt-1.5 list-disc space-y-0.5 ps-4 text-xs text-emerald-700">
            {analysis.staff.strengths.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        ) : null}
        {analysis.staff.issues.length ? (
          <ul className="mt-1 list-disc space-y-0.5 ps-4 text-xs text-amber-700">
            {analysis.staff.issues.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        ) : null}
      </div>

      {analysis.recommendations.length ? (
        <div>
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <Lightbulb size={13} aria-hidden="true" />
            توصيات لرفع الرضا
          </p>
          <ul className="mt-1 list-disc space-y-0.5 ps-4 text-xs">
            {analysis.recommendations.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2 border-t pt-2">
        <p className="text-[10px] text-muted-foreground">
          بناءً على {analysis.basis.messages.toLocaleString("ar-SA")} رسالة و
          {analysis.basis.bookings.toLocaleString("ar-SA")} حجز · تحليل آلي قد يخطئ
        </p>
        <Button size="sm" variant="ghost" onClick={onAnalyze} disabled={analyzing}>
          {analyzing ? <Spinner /> : "إعادة التحليل"}
        </Button>
      </div>
    </div>
  );
}

function Feed({ data }: { data: CustomerTimeline }) {
  if (data.events.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        لا يوجد سجل لهذه الزبونة بعد.
      </p>
    );
  }

  // Group by Riyadh day so a long history stays scannable.
  const groups: { key: string; label: string; events: TimelineEvent[] }[] = [];
  for (const ev of data.events) {
    const date = new Date(ev.at);
    const key = DAY_KEY_FMT.format(date);
    const last = groups.at(-1);
    if (last?.key === key) last.events.push(ev);
    else groups.push({ key, label: DAY_FMT.format(date), events: [ev] });
  }

  const older = data.messagesTotal - data.messagesShown;

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <section key={g.key}>
          <h4 className="sticky top-0 z-10 bg-popover py-1 text-xs font-semibold text-muted-foreground">
            {g.label}
          </h4>
          <ol className="space-y-2">
            {g.events.map((ev, i) => (
              <EventRow key={`${g.key}-${i}`} event={ev} />
            ))}
          </ol>
        </section>
      ))}
      {older > 0 ? (
        <p className="text-center text-xs text-muted-foreground">
          و {older.toLocaleString("ar-SA")} رسالة أقدم في المحادثة الكاملة
        </p>
      ) : null}
    </div>
  );
}

function EventRow({ event }: { event: TimelineEvent }) {
  const time = TIME_FMT.format(new Date(event.at));

  if (event.kind === "contact") {
    return (
      <Dot icon={<Sparkles size={12} />} tone="brand">
        <p className="text-sm font-medium">بداية التواصل</p>
        <Time>{time}</Time>
      </Dot>
    );
  }

  if (event.kind === "message") {
    const fromCustomer = event.role === "customer";
    return (
      <Dot
        icon={<MessageSquare size={12} />}
        tone={fromCustomer ? "customer" : "agent"}
      >
        <p className="text-xs text-muted-foreground">
          {fromCustomer ? "الزبونة" : event.role === "agent" ? "الصالون" : "النظام"}
        </p>
        <p className="line-clamp-3 text-sm">
          {event.content?.trim() ||
            (event.hasMedia ? "📎 مرفق" : `(${event.messageType})`)}
        </p>
        <Time>{time}</Time>
      </Dot>
    );
  }

  if (event.kind === "booking") {
    const cancelled = event.status === "Cancelled";
    return (
      <Dot icon={<CalendarCheck2 size={12} />} tone="booking">
        <div className="flex items-start justify-between gap-2">
          <p className={cn("text-sm font-medium", cancelled && "text-muted-foreground line-through")}>
            {event.service || "حجز"}
          </p>
          {event.amount ? (
            <span className="shrink-0 text-sm font-medium tabular-nums">
              {riyal(event.amount)}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={cancelled ? "destructive" : "secondary"} className="text-[11px]">
            {STATUS_LABEL[event.status] ?? event.status}
          </Badge>
          {event.payment ? (
            <span className="text-[11px] text-muted-foreground">
              {PAYMENT_LABEL[event.payment] ?? event.payment}
            </span>
          ) : null}
        </div>
        {event.providers.length ? (
          <p className="text-xs text-muted-foreground">
            مقدمة الخدمة: {event.providers.join("، ")}
          </p>
        ) : null}
        {event.location ? (
          <a
            href={`https://maps.google.com/?q=${event.location.lat},${event.location.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-[var(--brand)] underline underline-offset-2"
          >
            <MapPin size={11} aria-hidden="true" />
            {event.location.label || "الموقع"}
          </a>
        ) : null}
        <Time>{time}</Time>
      </Dot>
    );
  }

  if (event.kind === "driver") {
    return (
      <Dot icon={<Car size={12} />} tone="driver">
        <p className="text-sm font-medium">
          {DRIVER_STATUS_LABEL[event.status] ?? "طلب سائق"}
        </p>
        <p className="text-xs text-muted-foreground">
          {[
            event.specialistName && `الأخصائية: ${event.specialistName}`,
            event.driverName && `السائق: ${event.driverName}`,
            TRIP_LABEL[event.tripType],
          ]
            .filter(Boolean)
            .join(" · ") || "—"}
        </p>
        <Time>{time}</Time>
      </Dot>
    );
  }

  // note
  return (
    <Dot icon={<StickyNote size={12} />} tone="note">
      <p className="text-xs text-muted-foreground">
        ملاحظة داخلية{event.author ? ` · ${event.author}` : ""}
      </p>
      <p className="text-sm whitespace-pre-wrap">{event.body}</p>
      <Time>{time}</Time>
    </Dot>
  );
}

const DOT_TONE: Record<string, string> = {
  brand: "bg-[var(--brand)] text-white",
  customer: "bg-slate-200 text-slate-700",
  agent: "bg-emerald-100 text-emerald-700",
  booking: "bg-indigo-100 text-indigo-700",
  driver: "bg-amber-100 text-amber-700",
  note: "bg-slate-100 text-slate-600",
};

function Dot({
  icon,
  tone,
  children,
}: {
  icon: React.ReactNode;
  tone: keyof typeof DOT_TONE | string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-2">
      <span
        className={cn(
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full",
          DOT_TONE[tone] ?? DOT_TONE.note
        )}
        aria-hidden="true"
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1 space-y-0.5 rounded-lg bg-muted/40 px-3 py-2">
        {children}
      </div>
    </li>
  );
}

function Time({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] tabular-nums text-muted-foreground">{children}</p>;
}

function Stat({
  icon,
  label,
  value,
  hint,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "good";
}) {
  return (
    <div className="rounded-xl border bg-[var(--surface)] p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p
        className={cn(
          "mt-1 text-xl font-semibold tabular-nums",
          tone === "good" ? "text-emerald-600" : "text-[var(--foreground)]"
        )}
      >
        {value}
      </p>
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
