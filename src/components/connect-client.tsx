"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Smartphone, CheckCircle2, AlertTriangle } from "lucide-react";

interface EngineState {
  configured: boolean;
  state: string;
  number: string | null;
  qrDataUrl: string | null;
}

const ACTIVE_POLL = ["awaiting_qr", "authenticated", "initializing", "unknown"];

export function ConnectClient() {
  const [data, setData] = useState<EngineState | null>(null);
  const [error, setError] = useState(false);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp/state");
      if (!res.ok) {
        setError(true);
        return;
      }
      setError(false);
      setData(await res.json());
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void poll();
    const t = setInterval(poll, 3000);
    return () => clearInterval(t);
  }, [poll]);

  const state = data?.state ?? "loading";

  return (
    <div className="dashboard-page max-w-2xl">
      <div className="dashboard-page-header">
        <div>
          <h1>ربط واتساب</h1>
          <p>اربط رقم واتساب الصالون (‎+966594032490) لبدء استقبال وإرسال الرسائل.</p>
        </div>
      </div>

      <div className="rounded-2xl border bg-[var(--surface)] p-6">
        {!data ? (
          <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
            <Loader2 className="size-4 animate-spin" /> جارٍ التحقق من حالة الخدمة…
          </div>
        ) : !data.configured ? (
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" />
            <p className="text-sm">
              خدمة واتساب غير مُهيّأة بعد. اضبط متغيّرات OPENWA_URL وOPENWA_SEND_TOKEN.
            </p>
          </div>
        ) : state === "ready" ? (
          <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-4 text-green-800">
            <CheckCircle2 className="size-5" />
            <span className="text-sm font-medium">
              متصل{data.number ? ` كـ ‎+${data.number}` : ""} — الرسائل تعمل الآن.
            </span>
          </div>
        ) : error || state === "unreachable" ? (
          <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" />
            <p className="text-sm">تعذّر الوصول لخدمة واتساب. تأكد أن الخدمة تعمل على الخادم.</p>
          </div>
        ) : data.qrDataUrl && ACTIVE_POLL.includes(state) ? (
          <div className="flex flex-col items-center gap-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={data.qrDataUrl} alt="رمز QR" className="size-64" />
            </div>
            <ol className="max-w-sm space-y-1 text-sm text-slate-600">
              <li className="flex items-center gap-2">
                <Smartphone className="size-4" /> افتح واتساب على هاتف الصالون
              </li>
              <li>› الإعدادات › الأجهزة المرتبطة › ربط جهاز</li>
              <li>› وجّه الكاميرا نحو هذا الرمز</li>
            </ol>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
            <Loader2 className="size-4 animate-spin" /> الحالة: {state} — بانتظار الرمز…
          </div>
        )}
      </div>
    </div>
  );
}
