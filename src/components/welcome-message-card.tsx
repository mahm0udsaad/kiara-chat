"use client";

import { useCallback, useState } from "react";
import { Check, Loader2, MessageSquareHeart } from "lucide-react";
import type { WelcomeSettings } from "@/lib/welcome-message";

/**
 * The fixed welcome menu a customer gets when she starts a chat. What is in
 * the box is exactly what WhatsApp sends — nothing is added to it.
 */
export function WelcomeMessageCard({
  initial,
  quietDays,
}: {
  initial: WelcomeSettings;
  quietDays: number;
}) {
  const [settings, setSettings] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = useCallback((next: Partial<WelcomeSettings>) => {
    setSettings((prev) => ({ ...prev, ...next }));
    setSaved(false);
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/welcome-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "تعذّر الحفظ");
        return;
      }
      setSettings(data.settings as WelcomeSettings);
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
        <MessageSquareHeart size={18} className="text-[var(--brand)]" aria-hidden="true" />
        <h2 className="font-semibold text-[var(--foreground)]">رسالة الترحيب</h2>
      </div>

      <p className="text-sm text-muted-foreground">
        تُرسل تلقائيًا مرة واحدة عندما تبدأ عميلة محادثة: رقم يراسلنا لأول مرة،
        أو عميلة لم تراسلنا منذ {quietDays} يومًا. لا تُرسل لمن لديها حجز في ركاز
        خلال آخر {quietDays} يومًا أو حجز قادم.
      </p>

      <label className="flex cursor-pointer items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-sm font-medium text-[var(--foreground)]">
            تشغيل رسالة الترحيب
          </span>
          <span className="block text-xs text-muted-foreground">
            تعمل حتى لو كان البوت متوقفًا.
          </span>
        </span>
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => patch({ enabled: e.target.checked })}
          className="mt-0.5 size-5 shrink-0 accent-[var(--brand)]"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-sm text-[var(--foreground)]">نص الرسالة كما يصل للعميلة</span>
        <textarea
          value={settings.text}
          onChange={(e) => patch({ text: e.target.value })}
          rows={14}
          dir="auto"
          className="w-full rounded-lg border px-3 py-2 text-sm leading-relaxed outline-none focus:border-[var(--brand)]"
        />
        <span className="block text-xs text-[var(--subtle)] tabular-nums">
          {settings.text.length} / 4096
        </span>
      </label>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 font-medium text-white transition-opacity disabled:opacity-60"
      >
        {saving ? <Loader2 size={16} className="animate-spin" /> : null}
        {saved && !saving ? <Check size={16} /> : null}
        {saved && !saving ? "تم الحفظ" : "حفظ رسالة الترحيب"}
      </button>
    </section>
  );
}
