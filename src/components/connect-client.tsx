"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, AlertTriangle, BadgeCheck } from "lucide-react";

interface TwilioState {
  configured: boolean;
  provider: "twilio";
  number: string | null;
  state: string;
  error: string | null;
}

interface WhatsappState {
  twilio: TwilioState;
}

/**
 * This page used to show two numbers and a QR code, because the salon's
 * original number was a linked device that dropped its session every few weeks
 * and needed re-pairing from the phone. That number was retired on 2026-09-04.
 *
 * What is left has no failure an employee can fix from here — a Business
 * Platform sender is registered or it is not — so the page states the one rule
 * that does bite daily instead: the 24-hour window.
 */
export function ConnectClient() {
  const [data, setData] = useState<WhatsappState | null>(null);
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
    const initial = window.setTimeout(() => void poll(), 0);
    // Slower than the old three seconds: there is no QR racing an expiry now,
    // only a registration state that changes about once a year.
    const t = setInterval(poll, 30_000);
    return () => {
      window.clearTimeout(initial);
      clearInterval(t);
    };
  }, [poll]);

  const twilio = data?.twilio;

  return (
    <div className="dashboard-page max-w-2xl">
      <div className="dashboard-page-header">
        <div>
          <h1>رقم واتساب</h1>
          <p>
            كيّارا ترسل وتستقبل عبر رقم واتساب للأعمال. الرقم المرتبط بجهاز
            أُوقف نهائيًا.
          </p>
        </div>
      </div>

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

        {(twilio?.error || error) && (
          <p className="mt-3 text-sm text-red-700">
            {twilio?.error ?? "تعذّر قراءة حالة الرقم. أعيدي تحميل الصفحة."}
          </p>
        )}

        {/* The 24-hour rule is the one thing that behaves differently here, and
            it is invisible until a message silently fails — so it is stated. */}
        <p className="mt-4 rounded-lg bg-[var(--muted)] p-3 text-xs leading-relaxed text-muted-foreground">
          تُرسل الردود الحرّة خلال ٢٤ ساعة من آخر رسالة للعميلة. بعد ذلك يصل
          قالب معتمد فقط — وسيظهر ردّكِ في المحادثة بحالة «لم يُسلّم» مع إرسال
          رسالة متابعة تدعو العميلة للردّ.
        </p>
      </section>
    </div>
  );
}
