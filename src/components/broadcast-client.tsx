"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Send, Square } from "lucide-react";

interface Status {
  templateKey: string;
  approvedConfigured: boolean;
  total: number;
  sent: number;
  failed: number;
  remaining: number;
  sentLast24h: number;
  dailyCap: number;
  dailyRemaining: number;
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
  const [status, setStatus] = useState<Status | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const runningRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/broadcasts/${templateKey}`);
      if (res.ok) setStatus(await res.json());
    } catch {
      /* transient */
    }
  }, [templateKey]);

  useEffect(() => {
    // Initial status fetch; state is set inside the async callback, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

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
    // Drive the send by draining a batch at a time until nothing remains, the
    // daily cap is reached, or the admin stops.
    while (runningRef.current) {
      let result: DrainResult;
      try {
        const res = await fetch(`/api/broadcasts/${templateKey}`, { method: "POST" });
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
      if (result.status.remaining <= 0) {
        setNote("اكتمل الإرسال لجميع العميلات 🌿");
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
  }, [templateKey]);

  const pct = status && status.total ? Math.round((status.sent / status.total) * 100) : 0;

  return (
    <div className="dashboard-page max-w-2xl">
      <div className="dashboard-page-header">
        <div>
          <h1>إرسال جماعي — تنويه الرقم</h1>
          <p>
            إرسال القالب المعتمد إلى قائمة العملاء. يُرسل على دفعات، ويحترم الحد
            اليومي الذي يسمح به واتساب، ويمكن إيقافه ومتابعته في أي وقت.
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
                القالب غير جاهز للإرسال بعد. يجب اعتماده من واتساب أولًا، ثم ضبط
                متغيّر <code>TWILIO_CONTENT_SID_NUMBER_NOTICE</code>.
              </p>
            </div>
          )}

          <div className="rounded-2xl border bg-[var(--surface)] p-6">
            <div className="mb-4 grid grid-cols-3 gap-4 text-center">
              <Stat label="الإجمالي" value={status.total} />
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
              {status.sent} / {status.total} ({pct}%) — الحد اليومي:{" "}
              {status.sentLast24h}/{status.dailyCap}، المتبقّي اليوم{" "}
              {status.dailyRemaining}
              {status.failed ? ` — فشل ${status.failed} (سيُعاد إرسالها)` : ""}
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
                {status.remaining <= 0 ? "اكتمل الإرسال" : "بدء الإرسال"}
              </button>
            )}
            {running && (
              <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> جارٍ الإرسال… لا تغلقي
                الصفحة.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "good";
}) {
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
