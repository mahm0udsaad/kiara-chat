"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  MessageSquareText,
  Mic,
  Send,
  UserRound,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  VoiceNoteRecorder,
  type VoiceNote,
} from "@/components/voice-note-recorder";
import { loadDispatchOptions } from "@/lib/dispatch-options-client";
import { formatDuration, TRIP_TYPE_LABEL } from "@/lib/format";
import { nationalityOf } from "@/lib/nationalities";
import type { Driver, DriverOrderRow, Specialist, TripType } from "@/lib/types";

const TZ = "Asia/Riyadh";
const DAY_FMT = new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: TZ,
});
const TIME_FMT = new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TZ,
});
const isolateLtr = (value: string) => `\u2066${value}\u2069`;
type NoteMode = "text" | "voice";
const DRIVER_MESSAGE_REQUIRED = "اكتبي رسالة السائق قبل الإرسال";

function normalizedRosterName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLocaleLowerCase("ar");
}

function initialDriverMessage(
  order: DriverOrderRow,
  specialistName: string | null,
  tripType: TripType
): string {
  const customer = order.customer_name
    ? `${order.customer_name} (${isolateLtr(order.customer_phone)})`
    : isolateLtr(order.customer_phone);
  return [
    "🚗 *طلب جديد*",
    "",
    `👩 الأخصائية: ${specialistName ?? "—"}`,
    `🕒 موعد الوصول: ${DAY_FMT.format(new Date(order.arrival_at))}، ${TIME_FMT.format(
      new Date(order.arrival_at)
    )}`,
    `⏱️ مدة الجلسة: ${formatDuration(order.duration_minutes)}`,
    `🚕 نوع الرحلة: ${TRIP_TYPE_LABEL[tripType]}`,
    `📍 موقع الزبونة: ${order.customer_location}`,
    `📞 الزبونة: ${customer}`,
  ].join("\n");
}

/** Shared by the saved-order cards and the Rekaz table's immediate handoff. */
export function DispatchDialog({
  order,
  open,
  onOpenChange,
  onUpdated,
  preferredSpecialistName = null,
}: {
  order: DriverOrderRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: (order: DriverOrderRow) => void;
  /** Rekaz already names the provider; a normalized roster match preselects her. */
  preferredSpecialistName?: string | null;
}) {
  const [specialists, setSpecialists] = useState<Specialist[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [specialistId, setSpecialistId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [tripType, setTripType] = useState<TripType>(order.trip_type);
  const [specialistNote, setSpecialistNote] = useState("");
  const [driverMessage, setDriverMessage] = useState("");
  const [noteMode, setNoteMode] = useState<NoteMode>("text");
  const [voiceNote, setVoiceNote] = useState<VoiceNote | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    sent: boolean;
    specialistSent: boolean | null;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void loadDispatchOptions()
      .then((options) => {
        if (cancelled) return;
        const preferred = preferredSpecialistName
          ? options.specialists.find(
              (item) =>
                normalizedRosterName(item.full_name) ===
                normalizedRosterName(preferredSpecialistName)
            )
          : null;
        setSpecialists(options.specialists);
        setDrivers(options.drivers);
        const nextSpecialistId = order.specialist_id || preferred?.id || "";
        const nextSpecialist = options.specialists.find(
          (item) => item.id === nextSpecialistId
        );
        setSpecialistId(nextSpecialistId);
        setDriverId(order.driver_id || options.drivers[0]?.id || "");
        setTripType(order.trip_type);
        setDriverMessage(
          initialDriverMessage(order, nextSpecialist?.full_name ?? null, order.trip_type)
        );
        setConfirmed(false);
      })
      .catch(() => {
        if (!cancelled) setError("تعذّر تحميل الأخصائيات والسائقين");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, order, preferredSpecialistName]);

  const selectedSpecialist = specialists.find((item) => item.id === specialistId);
  const selectedDriver = drivers.find((item) => item.id === driverId);
  const language =
    nationalityOf(selectedSpecialist?.nationality)?.languageLabel ?? "العربية";
  const specialistMatchesRekaz = Boolean(
    preferredSpecialistName &&
      selectedSpecialist &&
      normalizedRosterName(preferredSpecialistName) ===
        normalizedRosterName(selectedSpecialist.full_name)
  );
  const reset = useCallback(() => {
    setSpecialistId("");
    setDriverId("");
    setTripType(order.trip_type);
    setSpecialistNote("");
    setDriverMessage("");
    setNoteMode("text");
    setVoiceNote((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
    setConfirmed(false);
    setLoading(true);
    setSubmitting(false);
    setError(null);
    setResult(null);
  }, [order.trip_type]);

  const changeOpen = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) reset();
      onOpenChange(nextOpen);
    },
    [onOpenChange, reset]
  );

  const send = useCallback(async () => {
    setError(null);
    if (!specialistId) return setError("اختاري الأخصائية");
    if (!driverId) return setError("اختاري السائق");
    if (!driverMessage.trim()) return setError(DRIVER_MESSAGE_REQUIRED);
    if (!confirmed) return setError("أكدي مراجعة رسالة السائق قبل الإرسال");

    setSubmitting(true);
    try {
      const voiceFile = noteMode === "voice" ? voiceNote?.file : null;
      let body: BodyInit;
      let headers: HeadersInit | undefined;
      if (voiceFile) {
        const form = new FormData();
        form.append("specialistId", specialistId);
        form.append("driverId", driverId);
        form.append("tripType", tripType);
        form.append("driverMessage", driverMessage.trim());
        form.append("specialistVoice", voiceFile, voiceFile.name);
        body = form;
      } else {
        headers = { "Content-Type": "application/json" };
        body = JSON.stringify({
          specialistId,
          driverId,
          tripType,
          specialistNote: noteMode === "text" ? specialistNote : "",
          driverMessage: driverMessage.trim(),
        });
      }
      const response = await fetch(`/api/orders/${order.id}/dispatch`, {
        method: "POST",
        headers,
        body,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data?.error ?? "تعذّر إرسال طلب السائق");
        return;
      }
      onUpdated(data.order as DriverOrderRow);
      setResult({
        sent: Boolean(data.sent),
        specialistSent:
          typeof data.specialistSent === "boolean" ? data.specialistSent : null,
      });
    } catch {
      setError("تعذّر إرسال طلب السائق");
    } finally {
      setSubmitting(false);
    }
  }, [
    confirmed,
    driverId,
    driverMessage,
    noteMode,
    onUpdated,
    order.id,
    specialistId,
    specialistNote,
    tripType,
    voiceNote,
  ]);

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>تأكيد الحجز وطلب السائق</DialogTitle>
          <DialogDescription>
            {result
              ? "اكتملت معالجة الطلب."
              : "بيانات الحجز مأخوذة من ركاز. راجعي الأخصائية والسائق والرسالة ثم أرسلي."}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="flex flex-col gap-4">
            <Alert variant={result.sent ? "default" : "destructive"}>
              {result.sent ? <CheckCircle2 /> : <AlertTriangle />}
              <AlertTitle>
                {result.sent ? "تم تأكيد الحجز وإرساله للسائق" : "تم حفظ الطلب ولم يُرسل"}
              </AlertTitle>
              <AlertDescription>
                {result.sent
                  ? "وصلت رسالة تفاصيل الموعد إلى السائق."
                  : "تحققي من ربط واتساب ثم استخدمي إعادة الإرسال من البطاقة."}
              </AlertDescription>
            </Alert>
            {result.specialistSent !== null ? (
              <Alert variant={result.specialistSent ? "default" : "destructive"}>
                <MessageSquareText />
                <AlertTitle>رسالة الأخصائية</AlertTitle>
                <AlertDescription>
                  {result.specialistSent
                    ? `أُرسلت نسخة الموعد إلى الأخصائية باللغة ${language}.`
                    : "تعذّر إرسال نسخة الأخصائية؛ راجعي رقمها وربط واتساب."}
                </AlertDescription>
              </Alert>
            ) : null}
            <DialogFooter>
              <Button onClick={() => changeOpen(false)}>تم</Button>
            </DialogFooter>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Spinner />
            جارٍ تحميل القوائم…
          </div>
        ) : !specialists.length || !drivers.length ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UserRound />
              </EmptyMedia>
              <EmptyTitle>القوائم غير مكتملة</EmptyTitle>
              <EmptyDescription>
                يجب إضافة أخصائية وسائق نشطين من صفحة الفريق أولًا.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <FieldGroup>
              <Field data-invalid={!specialistId && Boolean(error)}>
                <FieldLabel htmlFor={`dispatch-specialist-${order.id}`}>
                  الأخصائية
                </FieldLabel>
                <Select
                  value={specialistId}
                  onValueChange={(value) => {
                    const specialist = specialists.find((item) => item.id === value);
                    setSpecialistId(value);
                    setDriverMessage(
                      initialDriverMessage(
                        order,
                        specialist?.full_name ?? null,
                        tripType
                      )
                    );
                    setConfirmed(false);
                  }}
                >
                  <SelectTrigger
                    id={`dispatch-specialist-${order.id}`}
                    className="min-h-11 w-full"
                    aria-invalid={!specialistId && Boolean(error)}
                  >
                    <SelectValue placeholder="اختاري الأخصائية" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectGroup>
                      {specialists.map((specialist) => (
                        <SelectItem key={specialist.id} value={specialist.id}>
                          {specialist.full_name}
                          {specialist.phone
                            ? ` · ${isolateLtr(specialist.phone)}`
                            : " · بدون رقم"}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {selectedSpecialist ? (
                    selectedSpecialist.phone ? (
                      <>
                        {specialistMatchesRekaz ? "مطابقة لحجز ركاز" : "رقم الأخصائية"}
                        {" · "}
                        <span dir="ltr">{selectedSpecialist.phone}</span>
                      </>
                    ) : (
                      "الأخصائية المختارة ليس لها رقم واتساب مسجل."
                    )
                  ) : preferredSpecialistName ? (
                    `لم نجد «${preferredSpecialistName}» في قائمة الأخصائيات؛ اختاريها يدويًا.`
                  ) : (
                    "اختاري الأخصائية المسجلة على الحجز."
                  )}
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel>ملاحظة إضافية للأخصائية (اختياري)</FieldLabel>
                <ToggleGroup
                  type="single"
                  value={noteMode}
                  onValueChange={(value) => value && setNoteMode(value as NoteMode)}
                  variant="outline"
                  spacing={1}
                  className="w-full"
                  aria-label="نوع الملاحظة الإضافية"
                >
                  <ToggleGroupItem value="text" className="min-h-10 flex-1">
                    <MessageSquareText data-icon="inline-start" />
                    مكتوبة
                  </ToggleGroupItem>
                  <ToggleGroupItem value="voice" className="min-h-10 flex-1">
                    <Mic data-icon="inline-start" />
                    صوتية
                  </ToggleGroupItem>
                </ToggleGroup>
                {noteMode === "text" ? (
                  <>
                    <Textarea
                      id={`specialist-message-${order.id}`}
                      value={specialistNote}
                      onChange={(event) => setSpecialistNote(event.target.value)}
                      maxLength={500}
                      placeholder="تعليمات إضافية فقط…"
                      className="min-h-20"
                    />
                    <FieldDescription>
                      تفاصيل الحجز الأساسية ستصل تلقائيًا باللغة {language}.
                    </FieldDescription>
                  </>
                ) : (
                  <VoiceNoteRecorder
                    value={voiceNote}
                    onChange={setVoiceNote}
                    disabled={submitting}
                    description={`تفاصيل الحجز ستصل مكتوبة باللغة ${language}، والتسجيل الصوتي اختياري.`}
                  />
                )}
              </Field>

              <Field>
                <FieldLabel>نوع الرحلة</FieldLabel>
                <ToggleGroup
                  type="single"
                  value={tripType}
                  onValueChange={(value) => {
                    if (!value) return;
                    const nextTripType = value as TripType;
                    setTripType(nextTripType);
                    setDriverMessage(
                      initialDriverMessage(
                        order,
                        selectedSpecialist?.full_name ?? null,
                        nextTripType
                      )
                    );
                    setConfirmed(false);
                  }}
                  variant="outline"
                  spacing={1}
                  className="w-full"
                  aria-label="نوع الرحلة"
                >
                  <ToggleGroupItem value="one_way" className="min-h-10 flex-1">
                    ذهاب فقط
                  </ToggleGroupItem>
                  <ToggleGroupItem value="round_trip" className="min-h-10 flex-1">
                    ذهاب وعودة
                  </ToggleGroupItem>
                </ToggleGroup>
                <FieldDescription>
                  هذا التفصيل غير متوفر في ركاز، لذلك راجعيه قبل الإرسال.
                </FieldDescription>
              </Field>

              <Field data-invalid={!driverId && Boolean(error)}>
                <FieldLabel htmlFor={`dispatch-driver-${order.id}`}>السائق</FieldLabel>
                <Select value={driverId} onValueChange={setDriverId}>
                  <SelectTrigger
                    id={`dispatch-driver-${order.id}`}
                    className="min-h-11 w-full"
                    aria-invalid={!driverId && Boolean(error)}
                  >
                    <SelectValue placeholder="اختاري السائق" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectGroup>
                      {drivers.map((driver) => (
                        <SelectItem key={driver.id} value={driver.id}>
                          {driver.full_name} · {isolateLtr(driver.phone)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <Field data-invalid={!driverMessage.trim() && Boolean(error)}>
                <FieldLabel htmlFor={`driver-message-${order.id}`}>
                  رسالة السائق
                </FieldLabel>
                <Textarea
                  id={`driver-message-${order.id}`}
                  value={driverMessage}
                  onChange={(event) => {
                    setDriverMessage(event.target.value);
                    setConfirmed(false);
                  }}
                  maxLength={3000}
                  className="min-h-52 leading-7"
                  aria-invalid={!driverMessage.trim() && Boolean(error)}
                />
                <FieldDescription>
                  يمكنك تعديل النص قبل إرساله إلى{" "}
                  {selectedDriver?.full_name ?? "السائق المختار"}. رابط تأكيد بداية
                  ونهاية الجلسة سيُضاف تلقائيًا بعد الرسالة.
                </FieldDescription>
              </Field>

              <Field
                orientation="horizontal"
                data-invalid={!confirmed && Boolean(error)}
              >
                <Checkbox
                  id={`confirm-driver-message-${order.id}`}
                  checked={confirmed}
                  onCheckedChange={(checked) => setConfirmed(checked === true)}
                  aria-invalid={!confirmed && Boolean(error)}
                />
                <FieldContent>
                  <FieldTitle>
                    <FieldLabel htmlFor={`confirm-driver-message-${order.id}`}>
                      راجعت الحجز وأؤكد إرسال التفاصيل للسائق
                    </FieldLabel>
                  </FieldTitle>
                  <FieldDescription>
                    سيُحفظ اختيار الأخصائية والسائق حتى لو تعذّر إرسال واتساب.
                  </FieldDescription>
                </FieldContent>
              </Field>
              {error ? <FieldError>{error}</FieldError> : null}
            </FieldGroup>

            <DialogFooter>
              <Button variant="outline" onClick={() => changeOpen(false)}>
                إلغاء
              </Button>
              <Button onClick={send} disabled={submitting || !confirmed}>
                {submitting ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <Send data-icon="inline-start" />
                )}
                {submitting ? "جارٍ الإرسال…" : "تأكيد وإرسال"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
