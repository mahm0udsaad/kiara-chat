"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type {
  ServiceChangeList,
  ServiceChangePreview,
} from "@/lib/service-change-types";

const time = (value: string) =>
  new Date(value).toLocaleString("ar-SA", {
    timeZone: "Asia/Riyadh",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
export function OrderServiceChanges({
  orderId,
  onApproved,
}: {
  orderId: string;
  onApproved: () => void;
}) {
  const router = useRouter();
  const [list, setList] = useState<ServiceChangeList | null>(null);
  const [preview, setPreview] = useState<ServiceChangePreview | null>(null);
  const [name, setName] = useState("");
  const [minutes, setMinutes] = useState("30");
  const [manual, setManual] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const endpoint = `/api/orders/${orderId}/services`;
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const response = await fetch(endpoint, { signal, cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setList(data);
    },
    [endpoint],
  );
  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        return data;
      })
      .then(setList)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [endpoint]);
  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409) setPreview(null);
        throw new Error(data.error);
      }
      if (body.action === "preview") setPreview(data);
      else {
        setPreview(null);
        setManual(false);
        await load();
        if (body.action === "approve") {
          setNotice("تم اعتماد الخدمة وتحديث الزيارة. الإشعارات قيد الإرسال.");
          router.refresh();
          onApproved();
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذّر حفظ الخدمة");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="flex flex-col gap-3" aria-label="خدمات الزيارة">
      <h3 className="font-semibold">خدمات الزيارة</h3>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}
      {!list ? (
        <p>جارٍ تحميل الخدمات…</p>
      ) : (
        <>
          {list.services.map((s) => (
            <div key={s.id}>
              <p>
                {s.name} · {s.minutes} دقيقة ·{" "}
                {s.sourceId ? `ركاز #${s.sourceId}` : "إضافة يدوية"}
              </p>
              {!s.sourceId && list.canAdd && !preview ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setEditingId(s.id);
                    setName(s.name);
                    setMinutes(String(s.minutes));
                    setManual(true);
                  }}
                >
                  تعديل الخدمة
                </Button>
              ) : null}
            </div>
          ))}
          <p className="text-sm text-muted-foreground">
            آخر مزامنة: {list.syncedAt ? time(list.syncedAt) : "لم تتم بعد"}.
            الاقتراحات تحتاج اعتمادًا.
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void load().catch((e) => setError(e.message))}
          >
            تحديث الخدمات وحالة الإشعارات
          </Button>
          {!list.canAdd ? (
            <p>الإضافة متاحة بعد إرسال الطلب للأخصائية والسائق وقبل إنهاء الزيارة.</p>
          ) : null}
          {list.canAdd && !preview ? (
            <>
              {list.candidates.map((c) => (
                <div key={c.sourceId} className="flex flex-col gap-2">
                  <strong>
                    {c.kind === "update"
                      ? "تعديل في ركاز"
                      : "خدمة محتملة من ركاز"}
                    : {c.name} · {c.minutes} دقيقة
                  </strong>
                  <p className="text-sm text-muted-foreground">
                    {c.reasons.join(" · ")}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void act({ action: "preview", sourceId: c.sourceId })
                    }
                  >
                    مراجعة واعتماد
                  </Button>
                  {list.services
                    .filter((s) => !s.sourceId)
                    .map((s) => (
                      <Button
                        key={s.id}
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void act({
                            action: "preview",
                            sourceId: c.sourceId,
                            serviceId: s.id,
                            reconcile: true,
                          })
                        }
                      >
                        ربط بالخدمة اليدوية «{s.name}» دون زيادة الوقت
                      </Button>
                    ))}
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void act({ action: "dismiss", sourceId: c.sourceId })
                    }
                  >
                    إبقاء كطلب مستقل
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditingId(null);
                  setName("");
                  setMinutes("30");
                  setManual(!manual);
                }}
              >
                إضافة خدمة يدويًا
              </Button>
              {manual ? (
                <FieldGroup>
                  <p className="text-sm text-muted-foreground">
                    تُنفّذ بعد الخدمات الحالية بواسطة الأخصائية المسندة. لا
                    تُنشئ فاتورة في ركاز.
                  </p>
                  <Field>
                    <FieldLabel htmlFor={`service-name-${orderId}`}>
                      الخدمة
                    </FieldLabel>
                    <Input
                      id={`service-name-${orderId}`}
                      value={name}
                      maxLength={300}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`service-minutes-${orderId}`}>
                      المدة بالدقائق
                    </FieldLabel>
                    <Input
                      id={`service-minutes-${orderId}`}
                      type="number"
                      min={1}
                      max={480}
                      value={minutes}
                      onChange={(e) => setMinutes(e.target.value)}
                    />
                  </Field>
                  <Button
                    type="button"
                    disabled={busy || !name.trim()}
                    onClick={() =>
                      void act({
                        action: "preview",
                        name,
                        minutes: Number(minutes),
                        serviceId: editingId,
                      })
                    }
                  >
                    حساب الوقت ومراجعة الإشعارات
                  </Button>
                </FieldGroup>
              ) : null}
            </>
          ) : null}
          {list.notifications.map((n) => (
            <p key={n.id} className="text-sm">
              {n.role === "driver" ? "السائق" : "الأخصائية"}:{" "}
              {n.status === "accepted"
                ? "قُبل الإشعار للإرسال"
                : n.status === "failed"
                  ? "تعذّر إرسال الإشعار؛ راجعي وصوله مع الفريق"
                  : "الإشعار قيد الإرسال"}
            </p>
          ))}
        </>
      )}
      {preview ? (
        <FieldGroup>
          <strong>
            {preview.name} · {preview.minutes} دقيقة
          </strong>
          <p>
            الانتهاء: {time(preview.oldEnd)} ← {time(preview.newEnd)}. فرق
            الانتظار: {preview.extensionMinutes} دقيقة.
          </p>
          <Field>
            <FieldLabel htmlFor={`specialist-message-${orderId}`}>
              {preview.specialistTitle} — نص الأخصائية
            </FieldLabel>
            <Textarea
              id={`specialist-message-${orderId}`}
              rows={5}
              maxLength={2000}
              value={preview.specialistMessage}
              onChange={(e) =>
                setPreview({ ...preview, specialistMessage: e.target.value })
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`driver-message-${orderId}`}>
              {preview.driverTitle} — نص السائق
            </FieldLabel>
            <Textarea
              id={`driver-message-${orderId}`}
              rows={5}
              maxLength={2000}
              value={preview.driverMessage}
              onChange={(e) =>
                setPreview({ ...preview, driverMessage: e.target.value })
              }
            />
          </Field>
          <Button
            type="button"
            disabled={
              busy ||
              !preview.specialistMessage.trim() ||
              !preview.driverMessage.trim()
            }
            onClick={() =>
              void act({
                action: "approve",
                previewId: preview.id,
                specialistMessage: preview.specialistMessage,
                driverMessage: preview.driverMessage,
              })
            }
          >
            اعتماد الخدمة وإبلاغ الأخصائية والسائق
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => setPreview(null)}
          >
            رجوع للتعديل
          </Button>
        </FieldGroup>
      ) : null}
    </section>
  );
}
