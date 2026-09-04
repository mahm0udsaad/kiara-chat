"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Send, Square } from "lucide-react";

type Segment = "all" | "week" | "month" | "upcoming" | "dormant";

const SEGMENTS: { key: Segment; label: string; hint: string }[] = [
  { key: "all", label: "كل العملاء", hint: "القائمة كاملة" },
  { key: "week", label: "حجزوا هذا الأسبوع", hint: "آخر حجز خلال ٧ أيام" },
  { key: "month", label: "حجزوا هذا الشهر", hint: "آخر حجز خلال ٣٠ يومًا" },
  { key: "upcoming", label: "لديهم حجز قادم", hint: "موعد قادم لم يحن بعد" },
  { key: "dormant", label: "بدون حجز حديث", hint: "لا حجز في الفترة المسجّلة" },
];

interface Status {
  templateKey: string;
  segment: Segment;
  approvedConfigured: boolean;
  total: number;
  sent: number;
  failed: number;
  remaining: number;
  sentLast24h: number;
  dailyCap: number;
  dailyRemaining: number;
  segmentCounts: Record<Segment, number>;
}

interface DrainResult {
  attempted: number;
  sent: number;
  failed: number;
  status: Status;
  dailyCapReached: boolean;
  lastError: string | null;
}

export function BroadcastClient({ templateKey }: { templateKey: string }) {
  const [segment, setSegment] = useState<Segment>("all");
  const [status, setStatus] = useState<Status | null>(null);
  const [running, setRunning] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const runningRef = useRef(false);

  const load = useCallback(
    async (seg: Segment) => {
      try {
        const res = await fetch(`/api/broadcasts/${templateKey}?segment=${seg}`);
        if (res.ok) setStatus(await res.json());
      } catch {
        /* transient */
      }
    },
    [templateKey],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(segment);
  }, [load, segment]);

  const sync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch(`/api/broadcasts/${templateKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync", segment }),
      });
      const body = await res.json();
      if (!res.ok) setError(body.error || "تعذّر التحديث");
      else {
        setStatus(body.status);
        setNote(`تم تحديث القائمة من الحجوزات — الإجمالي ${body.synced} عميلة.`);
      }
    } catch {
      setError("انقطع الاتصال أثناء التحديث.");
    } finally {
      setSyncing(false);
    }
  }, [templateKey, segment]);

  const stop = useCallback(() => {
    runningRef.current = false;
    setRunning(false);
    setNote("تم الإيقاف. يمكنكِ المتابعة لاحقًا من حيث توقفتِ.");
  }, []);

  const run = useCallback(async () => {
    setError(null);
    setNote(null);
    runningRef.current = true;
    setRunning(true);
    while (runningRef.current) {
      let result: DrainResult;
      try {
        const res = await fetch(`/api/broadcasts/${templateKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ segment }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error || "تعذّر الإرسال");
          break;
        }
        result = await res.json();
      } catch {
        setError("انقطع الاتصال. حاولي مرة أخرى.");
        break;
      }
      setStatus(result.status);
      if (result.attempted > 0 && result.sent === 0 && result.failed > 0) {
        setError(
          result.lastError
            ? `تعذّر الإرسال — تأكدي من اعتماد القالب. التفاصيل: ${result.lastError}`
            : "تعذّر الإرسال — يبدو أن القالب لم يُعتمد بعد من واتساب.",
        );
        break;
      }
      if (result.status.remaining <= 0) {
        setNote("اكتمل الإرسال لهذه الفئة 🌿");
        break;
      }
      if (result.dailyCapReached) {
        setNote(
          `تم بلوغ الحد اليومي (${result.status.dailyCap} رسالة). تابعي غدًا لإرسال البقية.`,
        );
        break;
      }
      if (result.attempted === 0) break;
    }
    runningRef.current = false;
    setRunning(false);
  }, [templateKey, segment]);

  const pct = status && status.total ? Math.round((status.sent / status.total) * 100) : 0;
  const counts = status?.segmentCounts;

  return (
    <div className="dashboard-page max-w-2xl">
      <div className="dashboard-page-header">
        <div>
          <h1>إرسال جماعي — تنويه الرقم</h1>
          <p>
            اختاري فئة العملاء ثم أرسلي القالب المعتمد. يُرسل على دفعات، ويحترم
            الحد اليومي، ويمكن إيقافه ومتابعته في أي وقت.
          </p>
        </div>
      </div>

      {!status ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> جارٍ التحميل…
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {!status.approvedConfigured && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800">
              <AlertTriangle className="mt-0.5 size-5 shrink-0" />
              <p className="text-sm">
                القالب غير جاهز للإرسال بعد. يجب اعتماده من واتساب أولًا.
              </p>
            </div>
          )}

          {/* Segment picker */}
          <div className="rounded-2xl border bg-[var(--surface)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium">فئة العملاء</span>
              <button
                type="button"
                onClick={sync}
                disabled={syncing || running}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                <RefreshCw className={`size-3.5 ${syncing ? "animate-spin" : ""}`} />
                تحديث من الحجوزات
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {SEGMENTS.map((s) => {
                const active = segment === s.key;
                const n = counts?.[s.key];
                return (
                  <button
                    key={s.key}
                    type="button"
                    disabled={running}
                    onClick={() => setSegment(s.key)}
                    className={`flex flex-col gap-0.5 rounded-lg border p-3 text-right transition disabled:opacity-60 ${
                      active
                        ? "border-[var(--brand,#12505c)] bg-[var(--accent-wash,#e2eff1)]"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}
                  >
                    <span className="flex items-center justify-between">
                      <span className="text-sm font-medium">{s.label}</span>
                      <span className="text-sm font-bold tabular-nums text-[var(--brand,#12505c)]">
                        {n ?? "…"}
                      </span>
                    </span>
                    <span className="text-[11px] text-muted-foreground">{s.hint}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Progress + send for the chosen segment */}
          <div className="rounded-2xl border bg-[var(--surface)] p-6">
            <div className="mb-4 grid grid-cols-3 gap-4 text-center">
              <Stat label="في الفئة" value={status.total} />
              <Stat label="تم الإرسال" value={status.sent} tone="good" />
              <Stat label="المتبقّي" value={status.remaining} />
            </div>

            <div className="mb-2 h-2 overflow-hidden rounded-full bg-[var(--muted)]">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mb-4 text-xs text-muted-foreground">
              {status.sent} / {status.total} ({pct}%) — الحد اليومي (لكل الفئات):{" "}
              {status.sentLast24h}/{status.dailyCap}، المتبقّي اليوم{" "}
              {status.dailyRemaining}
              {status.failed ? ` — فشل ${status.failed} (سيُعاد إرساله)` : ""}
            </p>

            {error && (
              <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
              </div>
            )}
            {note && (
              <div className="mb-3 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> {note}
              </div>
            )}

            {running ? (
              <button
                type="button"
                onClick={stop}
                className="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50"
              >
                <Square className="size-4" /> إيقاف
              </button>
            ) : (
              <button
                type="button"
                onClick={run}
                disabled={!status.approvedConfigured || status.remaining <= 0}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand,#12505c)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
              >
                <Send className="size-4" />
                {status.remaining <= 0
                  ? "لا يوجد متبقٍّ في هذه الفئة"
                  : `إرسال إلى ${status.remaining} عميلة`}
              </button>
            )}
            {running && (
              <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> جارٍ الإرسال… لا تغلقي الصفحة.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "good" }) {
  return (
    <div>
      <div
        className={`text-2xl font-bold tabular-nums ${
          tone === "good" ? "text-emerald-600" : "text-[var(--ink,#16201f)]"
        }`}
      >
        {value}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
