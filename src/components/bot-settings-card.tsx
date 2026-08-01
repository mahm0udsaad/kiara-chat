"use client";

import { useCallback, useMemo, useState } from "react";
import { Bot, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { describeSchedule, type BotSettings } from "@/lib/bot-schedule";

/**
 * The auto-reply bot's controls: master switch plus the daily window it may
 * answer in. Owner/manager-only (the whole settings route is admin-guarded).
 *
 * The window is stored on the shared restaurants row, so turning the bot off
 * here also stops it in the parent app — that's deliberate, it's one bot.
 */
export function BotSettingsCard({ initial }: { initial: BotSettings }) {
  const [settings, setSettings] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = useCallback((next: Partial<BotSettings>) => {
    setSettings((prev) => ({ ...prev, ...next }));
    setSaved(false);
  }, []);

  const summary = useMemo(() => describeSchedule(settings), [settings]);
  const allDay = settings.start === settings.end;

  const save = useCallback(async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/ai-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "تعذّر الحفظ");
        return;
      }
      setSettings(data.settings as BotSettings);
      setSaved(true);
    } catch {
      setError("تعذّر الحفظ");
    } finally {
      setSaving(false);
    }
  }, [settings]);

  return (
    <section className="mt-6 space-y-4 rounded-2xl border bg-[var(--surface)] p-4">
      <div className="flex items-center gap-2">
        <Bot size={18} className="text-[var(--brand)]" aria-hidden="true" />
        <h2 className="font-semibold text-[var(--foreground)]">الرد الآلي (البوت)</h2>
      </div>

      <p className="text-sm text-muted-foreground">
        يرد البوت على أسئلة الزبونات من معرفة كيارا (الخدمات والأسعار والمدد)،
        ويجمع تفاصيل الحجز ثم يحوّل المحادثة لكِ. الشكاوى وأي سؤال خارج معرفته
        تتحول لموظفة مباشرة.
      </p>

      <Toggle
        label="تشغيل البوت"
        hint="إيقافه يعني ألا يرد على أي محادثة."
        checked={settings.enabled}
        onChange={(v) => patch({ enabled: v })}
      />

      <div
        className={cn(
          "space-y-4 rounded-xl border p-3 transition-opacity",
          !settings.enabled && "pointer-events-none opacity-50"
        )}
      >
        <Toggle
          label="تحديد ساعات عمل للبوت"
          hint="بدون تحديد، يعمل على مدار الساعة."
          checked={settings.scheduleEnabled}
          onChange={(v) => patch({ scheduleEnabled: v })}
        />

        <div
          className={cn(
            "space-y-3 transition-opacity",
            !settings.scheduleEnabled && "pointer-events-none opacity-50"
          )}
        >
          <div className="grid grid-cols-2 gap-2">
            <TimeInput
              id="bot-start"
              label="من"
              value={settings.start}
              onChange={(v) => patch({ start: v })}
            />
            <TimeInput
              id="bot-end"
              label="إلى"
              value={settings.end}
              onChange={(v) => patch({ end: v })}
            />
          </div>
          <p className="text-xs text-[var(--subtle)]">
            {allDay
              ? "الوقتان متساويان — أي أن البوت يعمل ٢٤ ساعة."
              : "لو كان وقت البداية بعد وقت النهاية (مثل ٢٢:٠٠ إلى ٠٦:٠٠) يُحسب كفترة ليلية تمتد لليوم التالي."}
          </p>

          <Toggle
            label="٢٤ ساعة يومي الجمعة والسبت"
            hint="يتجاوز الفترة المحددة في نهاية الأسبوع."
            checked={settings.weekend24h}
            onChange={(v) => patch({ weekend24h: v })}
          />

          <label className="block space-y-1">
            <span className="text-sm text-[var(--foreground)]">المنطقة الزمنية</span>
            <input
              value={settings.timezone}
              onChange={(e) => patch({ timezone: e.target.value })}
              dir="ltr"
              className="min-h-11 w-full rounded-lg border px-3 text-sm outline-none focus:border-[var(--brand)]"
            />
          </label>
        </div>
      </div>

      <p className="rounded-lg bg-[var(--brand-soft)] px-3 py-2 text-sm text-[var(--brand)]">
        {summary}
      </p>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 font-medium text-white transition-opacity disabled:opacity-60"
      >
        {saving ? <Loader2 size={16} className="animate-spin" /> : null}
        {saved && !saving ? <Check size={16} /> : null}
        {saved && !saving ? "تم الحفظ" : "حفظ إعدادات البوت"}
      </button>

      <BotTester />
    </section>
  );
}

/**
 * Ask the bot a question and see the answer it *would* send. Nothing goes to
 * WhatsApp — this is the safe way to check its tone and whether Kiara's
 * knowledge actually covers a question before a customer asks it.
 */
function BotTester() {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<{
    reply: string;
    handoff: boolean;
    handoffReason: string;
    grounded: boolean;
    similarity: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = useCallback(async () => {
    if (!question.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/bot/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "تعذّرت التجربة");
        return;
      }
      setResult(data.preview);
    } catch {
      setError("تعذّرت التجربة");
    } finally {
      setBusy(false);
    }
  }, [question]);

  return (
    <div className="space-y-2 rounded-xl border border-dashed p-3">
      <p className="text-sm font-medium text-[var(--foreground)]">جرّبي البوت</p>
      <p className="text-xs text-muted-foreground">
        اكتبي سؤالًا كما تكتبه الزبونة — يظهر الرد هنا فقط ولا يُرسل لأحد.
      </p>
      <textarea
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        rows={2}
        placeholder="مثال: كم سعر مساج الحامل؟"
        className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-[var(--brand)]"
      />
      <button
        type="button"
        onClick={ask}
        disabled={busy || !question.trim()}
        className="flex min-h-10 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm text-[var(--brand)] disabled:opacity-50"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : null}
        اسألي
      </button>

      {error ? <p className="text-xs text-rose-600">{error}</p> : null}

      {result ? (
        <div className="space-y-1.5 rounded-lg bg-black/[0.03] p-3">
          <p className="whitespace-pre-wrap text-sm text-[var(--foreground)]">{result.reply}</p>
          <p className="text-[11px] text-muted-foreground">
            {result.handoff ? `سيحوّل المحادثة (${result.handoffReason})` : "سيكمل بنفسه"} ·{" "}
            {result.grounded ? "مستند لمعرفة كيارا" : "لم يجد معرفة قوية"} · تطابق{" "}
            <span className="tabular-nums">{result.similarity.toFixed(2)}</span>
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-[var(--foreground)]">{label}</span>
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-5 shrink-0 accent-[var(--brand)]"
      />
    </label>
  );
}

function TimeInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label htmlFor={id} className="block space-y-1">
      <span className="text-sm text-[var(--foreground)]">{label}</span>
      <input
        id={id}
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        dir="ltr"
        className="min-h-11 w-full rounded-lg border px-3 text-sm tabular-nums outline-none focus:border-[var(--brand)]"
      />
    </label>
  );
}
