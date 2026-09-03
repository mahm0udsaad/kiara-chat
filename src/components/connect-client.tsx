"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  Smartphone,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  BadgeCheck,
} from "lucide-react";

interface EngineState {
  configured: boolean;
  state: string;
  number: string | null;
  qrDataUrl: string | null;
  qrUpdatedAt: number | null;
  qrMaxAgeMs: number | null;
}

interface TwilioState {
  configured: boolean;
  provider: "twilio";
  number: string | null;
  state: string;
  error: string | null;
}

interface WhatsappState {
  openwa: EngineState;
  twilio: TwilioState;
}

const ACTIVE_POLL = ["awaiting_qr", "authenticated", "initializing", "unknown"];
const FALLBACK_MAX_AGE_MS = 45000;

export function ConnectClient() {
  const [data, setData] = useState<WhatsappState | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Ticks once a second purely to drive the countdown re-render.
  const [now, setNow] = useState(() => Date.now());

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
    const initial = window.setTimeout(() => void poll(), 0);
    const t = setInterval(poll, 3000);
    return () => {
      window.clearTimeout(initial);
      clearInterval(t);
    };
  }, [poll]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const requestFreshQr = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetch("/api/whatsapp/refresh", { method: "POST" });
      // The engine restarts its browser to mint a new code; poll picks it up.
      await poll();
    } catch {
      setError(true);
    } finally {
      setRefreshing(false);
    }
  }, [poll]);

  const engine = data?.openwa;
  const twilio = data?.twilio;
  const state = engine?.state ?? "loading";
  const maxAge = engine?.qrMaxAgeMs ?? FALLBACK_MAX_AGE_MS;
  const secondsLeft = engine?.qrUpdatedAt
    ? Math.max(0, Math.ceil((engine.qrUpdatedAt + maxAge - now) / 1000))
    : null;
  const expired = secondsLeft === 0;

  return (
    <div className="dashboard-page max-w-2xl">
      <div className="dashboard-page-header">
        <div>
          <h1>أرقام واتساب</h1>
          {/* Two numbers, deliberately. Neither replaces the other: each
              conversation is ردّ عليها من نفس الرقم الذي وصلت منه. */}
          <p>
            كيّارا تعمل على رقمين في الوقت نفسه — رقم مرتبط بجهاز، ورقم واتساب
            للأعمال. كل محادثة يُردّ عليها من الرقم الذي وصلت منه.
          </p>
        </div>
      </div>

      {/* ---------- Business Platform sender (Twilio) ---------- */}
      <section className="rounded-2xl border bg-[var(--surface)] p-6">
        <header className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">رقم واتساب للأعمال</h2>
            <p className="text-sm text-muted-foreground">
              مسجّل لدى واتساب مباشرة — لا يحتاج مسح رمز ولا يرتبط بهاتف.
            </p>
          </div>
        </header>

        {!twilio ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> جارٍ التحقق…
          </div>
        ) : !twilio.configured ? (
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" />
            <p className="text-sm">
              لم تُضبط بيانات الاتصال بعد. أضيفي متغيّرات Twilio في إعدادات
              النشر ثم أعيدي تحميل الصفحة.
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-4 text-green-800">
            <BadgeCheck className="size-5 shrink-0" />
            <span className="text-sm font-medium">
              جاهز{twilio.number ? ` — ‎${twilio.number}` : ""}. الاستقبال
              والإرسال يعملان.
            </span>
          </div>
        )}

        {twilio?.error && (
          <p className="mt-3 text-sm text-red-700">{twilio.error}</p>
        )}

        {/* The 24-hour rule is the one thing that behaves differently here, and
            it is invisible until a message silently fails — so it is stated. */}
        <p className="mt-4 rounded-lg bg-[var(--muted)] p-3 text-xs leading-relaxed text-muted-foreground">
          على هذا الرقم، تُرسل الردود الحرّة خلال ٢٤ ساعة من آخر رسالة للعميلة.
          بعد ذلك يصل قالب معتمد فقط — وسيظهر ردّكِ في المحادثة بحالة «لم
          يُسلّم» مع إرسال رسالة متابعة تدعو العميلة للردّ.
        </p>
      </section>

      {/* ---------- Linked device (OpenWA) ---------- */}
      <section className="mt-6 rounded-2xl border bg-[var(--surface)] p-6">
        <header className="mb-4">
          <h2 className="text-base font-semibold">الرقم المرتبط بجهاز</h2>
          <p className="text-sm text-muted-foreground">
            الرقم الأساسي للصالون. يحتاج إعادة ربط إذا انقطعت الجلسة.
          </p>
        </header>

        {!engine ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> جارٍ التحقق من حالة الخدمة…
          </div>
        ) : !engine.configured ? (
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" />
            <p className="text-sm">
              خدمة واتساب غير مُهيّأة بعد. اضبطي متغيّرات OPENWA_URL و
              OPENWA_SEND_TOKEN.
            </p>
          </div>
        ) : state === "ready" ? (
          <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-4 text-green-800">
            <CheckCircle2 className="size-5" />
            <span className="text-sm font-medium">
              متصل{engine.number ? ` كـ ‎+${engine.number}` : ""} — الرسائل تعمل الآن.
            </span>
          </div>
        ) : error || state === "unreachable" ? (
          <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" />
            <p className="text-sm">
              تعذّر الوصول لخدمة واتساب. تأكدي أن الخدمة تعمل على الخادم.
            </p>
          </div>
        ) : engine.qrDataUrl && ACTIVE_POLL.includes(state) ? (
          <div className="flex flex-col items-center gap-4">
            <div className="relative rounded-xl border border-slate-200 bg-white p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={engine.qrDataUrl}
                alt="رمز QR"
                className={`size-64 transition ${expired ? "opacity-20 blur-sm" : ""}`}
              />
              {expired && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
                  <AlertTriangle className="size-6 text-amber-600" />
                  <p className="px-4 text-sm font-medium text-slate-700">
                    انتهت صلاحية الرمز
                  </p>
                </div>
              )}
            </div>

            {/* A WhatsApp QR dies after about a minute; show exactly how long is
                left so nobody scans a dead code and blames their phone. */}
            {secondsLeft !== null && !expired && (
              <p className="text-sm text-slate-600">
                صالح لمدة{" "}
                <span
                  className={`font-semibold tabular-nums ${
                    secondsLeft <= 10 ? "text-red-600" : "text-slate-900"
                  }`}
                >
                  {secondsLeft}
                </span>{" "}
                ثانية
              </p>
            )}

            <button
              type="button"
              onClick={requestFreshQr}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
            >
              {refreshing ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> جارٍ إنشاء رمز جديد…
                </>
              ) : (
                <>
                  <RefreshCw className="size-4" /> رمز جديد
                </>
              )}
            </button>

            <ol className="max-w-sm space-y-1 text-sm text-slate-600">
              <li className="flex items-center gap-2">
                <Smartphone className="size-4" /> افتحي واتساب على هاتف الصالون
              </li>
              <li>› الإعدادات › الأجهزة المرتبطة › ربط جهاز</li>
              <li>› وجّهي الكاميرا نحو هذا الرمز</li>
            </ol>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> الحالة: {state} — بانتظار الرمز…
            </div>
            <button
              type="button"
              onClick={requestFreshQr}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} /> رمز جديد
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
