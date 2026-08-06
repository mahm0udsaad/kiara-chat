"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  MessageSquareText,
  Mic,
  Send,
  UserRound,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Separator } from "@/components/ui/separator";
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
import type { Driver, DriverOrderRow, Specialist } from "@/lib/types";

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
const SPECIALIST_TEXT_REQUIRED =
  "اكتبي رسالة للأخصائية أو اختاري رسالة صوتية";
const SPECIALIST_VOICE_REQUIRED = "سجّلي رسالة صوتية للأخصائية";

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
  /** Rekaz already names the provider; an exact roster match preselects her. */
  preferredSpecialistName?: string | null;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [specialists, setSpecialists] = useState<Specialist[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [specialistId, setSpecialistId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [specialistNote, setSpecialistNote] = useState("");
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
                item.full_name.trim().toLocaleLowerCase("ar") ===
                preferredSpecialistName.trim().toLocaleLowerCase("ar")
            )
          : null;
        setSpecialists(options.specialists);
        setDrivers(options.drivers);
        setSpecialistId(
          (current) => current || preferred?.id || options.specialists[0]?.id || ""
        );
        setDriverId((current) => current || options.drivers[0]?.id || "");
        // A Rekaz provider match saves a selection only. The employee must still
        // add the specialist's written or voice message before choosing a driver.
        setStep(1);
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
  }, [open, preferredSpecialistName]);

  const selectedSpecialist = specialists.find((item) => item.id === specialistId);
  const selectedDriver = drivers.find((item) => item.id === driverId);
  const language =
    nationalityOf(selectedSpecialist?.nationality)?.languageLabel ?? "العربية";
  const specialistMessageInvalid =
    error === SPECIALIST_TEXT_REQUIRED || error === SPECIALIST_VOICE_REQUIRED;
  const driverPreview = useMemo(
    () =>
      [
        "🚗 طلب جديد",
        `الأخصائية: ${selectedSpecialist?.full_name ?? "—"}`,
        `موعد الوصول: ${DAY_FMT.format(new Date(order.arrival_at))}، ${TIME_FMT.format(
          new Date(order.arrival_at)
        )}`,
        `مدة الجلسة: ${formatDuration(order.duration_minutes)}`,
        `نوع الرحلة: ${TRIP_TYPE_LABEL[order.trip_type]}`,
        `موقع الزبونة: ${order.customer_location}`,
        `رقم الزبونة: ${isolateLtr(order.customer_phone)}`,
      ].join("\n"),
    [order, selectedSpecialist?.full_name]
  );

  const reset = useCallback(() => {
    setStep(1);
    setSpecialistId("");
    setDriverId("");
    setSpecialistNote("");
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
  }, []);

  const changeOpen = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) reset();
      onOpenChange(nextOpen);
    },
    [onOpenChange, reset]
  );

  const nextStep = useCallback(() => {
    setError(null);
    if (!specialistId) return setError("اختاري الأخصائية");
    if (noteMode === "text" && !specialistNote.trim()) {
      return setError(SPECIALIST_TEXT_REQUIRED);
    }
    if (noteMode === "voice" && !voiceNote) {
      return setError(SPECIALIST_VOICE_REQUIRED);
    }
    setStep(2);
  }, [noteMode, specialistId, specialistNote, voiceNote]);

  const send = useCallback(async () => {
    setError(null);
    if (!specialistId) return setError("اختاري الأخصائية");
    if (!driverId) return setError("اختاري السائق");
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
        form.append("specialistVoice", voiceFile, voiceFile.name);
        body = form;
      } else {
        headers = { "Content-Type": "application/json" };
        body = JSON.stringify({
          specialistId,
          driverId,
          specialistNote: noteMode === "text" ? specialistNote : "",
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
    noteMode,
    onUpdated,
    order.id,
    specialistId,
    specialistNote,
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
              : `الخطوة ${step.toLocaleString("ar")} من ٢ — ${
                  step === 1 ? "الأخصائية والرسالة" : "السائق والتأكيد"
                }`}
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
            <div className="flex items-center gap-2" aria-hidden="true">
              <Badge variant={step === 1 ? "default" : "secondary"}>١</Badge>
              <Separator className="flex-1" />
              <Badge variant={step === 2 ? "default" : "secondary"}>٢</Badge>
            </div>

            {step === 1 ? (
              <FieldGroup>
                <Field data-invalid={!specialistId && Boolean(error)}>
                  <FieldLabel htmlFor={`dispatch-specialist-${order.id}`}>
                    الأخصائية
                  </FieldLabel>
                  <Select value={specialistId} onValueChange={setSpecialistId}>
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
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field data-invalid={specialistMessageInvalid}>
                  <FieldLabel>رسالة للأخصائية</FieldLabel>
                  <ToggleGroup
                    type="single"
                    value={noteMode}
                    onValueChange={(value) => value && setNoteMode(value as NoteMode)}
                    variant="outline"
                    spacing={1}
                    className="w-full"
                    aria-label="نوع الرسالة"
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
                        placeholder="اكتبي ملاحظة الموعد أو تعليمات الوصول…"
                        className="min-h-28"
                        aria-invalid={specialistMessageInvalid}
                      />
                      <FieldDescription>
                        ستصل تفاصيل الحجز ورسالتك المكتوبة باللغة {language} حسب
                        الجنسية المسجلة للأخصائية.
                      </FieldDescription>
                    </>
                  ) : (
                    <VoiceNoteRecorder
                      value={voiceNote}
                      onChange={setVoiceNote}
                      disabled={submitting}
                      description={`تفاصيل الحجز تُرسل مكتوبة ومترجمة إلى ${language}، ويصلها تسجيلك بصوتك بعدها.`}
                    />
                  )}
                </Field>
                {error ? <FieldError>{error}</FieldError> : null}
              </FieldGroup>
            ) : (
              <FieldGroup>
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

                <Card size="sm">
                  <CardHeader>
                    <CardTitle>معاينة رسالة السائق</CardTitle>
                    <CardDescription>
                      ستُرسل إلى {selectedDriver?.full_name ?? "السائق المختار"}.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="whitespace-pre-wrap text-sm leading-7">{driverPreview}</p>
                  </CardContent>
                </Card>

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
            )}

            <DialogFooter>
              {step === 2 ? (
                <Button variant="outline" onClick={() => setStep(1)}>
                  السابق
                </Button>
              ) : (
                <Button variant="outline" onClick={() => changeOpen(false)}>
                  إلغاء
                </Button>
              )}
              {step === 1 ? (
                <Button onClick={nextStep}>التالي</Button>
              ) : (
                <Button onClick={send} disabled={submitting || !confirmed}>
                  {submitting ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <Send data-icon="inline-start" />
                  )}
                  {submitting ? "جارٍ الإرسال…" : "تأكيد وإرسال"}
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
