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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  VoiceNoteRecorder,
  type VoiceNote,
} from "@/components/voice-note-recorder";
import { loadDispatchOptions } from "@/lib/dispatch-options-client";
import { formatDuration, isLocationUnset, TRIP_TYPE_LABEL } from "@/lib/format";
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
const DRIVER_MESSAGE_REQUIRED = "اكتبي ملاحظة السائق قبل الإسناد";
const LOCATION_REQUIRED = "حدّدي موقع العميلة أولًا";

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
  tripType: TripType,
  customerLocation: string
): string {
  // Mirrors formatDriverOrderMessage on the server: the journey, and nothing
  // about the customer beyond where she is. He gets no phone and no service
  // list — those are the specialist's to carry.
  return [
    "🚗 *طلب جديد*",
    "",
    `👩 الأخصائية: ${specialistName ?? "—"}`,
    `🕒 موعد الوصول: ${DAY_FMT.format(new Date(order.arrival_at))}، ${TIME_FMT.format(
      new Date(order.arrival_at)
    )}`,
    `⏱️ مدة الجلسة: ${formatDuration(order.duration_minutes)}`,
    `🚕 نوع الرحلة: ${TRIP_TYPE_LABEL[tripType]}`,
    `📍 موقع الزبونة: ${customerLocation}`,
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
  const [pendingSpecialistId, setPendingSpecialistId] = useState<string | null>(null);
  const [driverId, setDriverId] = useState("");
  const [tripType, setTripType] = useState<TripType>(order.trip_type);
  // The address is the first thing this form settles. An order raised from
  // ركاز arrives with the placeholder, which must not be offered as a value
  // she can leave alone — she starts from an empty box in that case.
  const [customerLocation, setCustomerLocation] = useState(
    isLocationUnset(order.customer_location) ? "" : order.customer_location
  );
  const [specialistNote, setSpecialistNote] = useState("");
  const [driverMessage, setDriverMessage] = useState("");
  const [finalDriverMessage, setFinalDriverMessage] = useState("");
  const [specialistMessage, setSpecialistMessage] = useState("");
  const [previewLanguage, setPreviewLanguage] = useState("العربية");
  const [automaticAdditions, setAutomaticAdditions] = useState<string[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [noteMode, setNoteMode] = useState<NoteMode>("text");
  const [voiceNote, setVoiceNote] = useState<VoiceNote | null>(null);
  // Optional, and deliberately not remembered across orders: a door belongs to
  // one address.
  const [doorPhoto, setDoorPhoto] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    /** The driver's WhatsApp copy. The order is assigned regardless. */
    sent: boolean;
    /** Null when she has no number and only the app copy was made. */
    specialistSent: boolean | null;
    notified: boolean;
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
          initialDriverMessage(
            order,
            nextSpecialist?.full_name ?? null,
            order.trip_type,
            isLocationUnset(order.customer_location) ? "" : order.customer_location
          )
        );
        setConfirmed(false);
        setReviewing(false);
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

  const locationMissing = isLocationUnset(customerLocation);
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
  const pendingSpecialist = specialists.find(
    (item) => item.id === pendingSpecialistId
  );
  const applySpecialist = useCallback(
    (value: string) => {
      const specialist = specialists.find((item) => item.id === value);
      setSpecialistId(value);
      setDriverMessage(
        initialDriverMessage(
          order,
          specialist?.full_name ?? null,
          tripType,
          customerLocation
        )
      );
      setConfirmed(false);
      setReviewing(false);
    },
    [customerLocation, order, specialists, tripType]
  );
  const requestSpecialistChange = useCallback(
    (value: string) => {
      if (!specialistId || value === specialistId) {
        applySpecialist(value);
        return;
      }
      setPendingSpecialistId(value);
    },
    [applySpecialist, specialistId]
  );
  const reset = useCallback(() => {
    setSpecialistId("");
    setPendingSpecialistId(null);
    setDriverId("");
    setTripType(order.trip_type);
    setCustomerLocation(
      isLocationUnset(order.customer_location) ? "" : order.customer_location
    );
    setSpecialistNote("");
    setDoorPhoto(null);
    setDriverMessage("");
    setFinalDriverMessage("");
    setSpecialistMessage("");
    setPreviewLanguage("العربية");
    setAutomaticAdditions([]);
    setReviewing(false);
    setPreviewing(false);
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
  }, [order.customer_location, order.trip_type]);

  const changeOpen = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) reset();
      onOpenChange(nextOpen);
    },
    [onOpenChange, reset]
  );

  const send = useCallback(async () => {
    setError(null);
    if (isLocationUnset(customerLocation)) return setError(LOCATION_REQUIRED);
    if (!specialistId) return setError("اختاري الأخصائية");
    if (!driverId) return setError("اختاري السائق");
    if (!finalDriverMessage.trim()) return setError(DRIVER_MESSAGE_REQUIRED);
    if (!specialistMessage.trim()) return setError("راجعي ملاحظة الأخصائية النهائية");
    if (!reviewing) return setError("جهّزي الملاحظات النهائية وراجعيها أولًا");
    if (!confirmed) return setError("أكدي مراجعة ملاحظة السائق قبل الإسناد");

    setSubmitting(true);
    try {
      const voiceFile = noteMode === "voice" ? voiceNote?.file : null;
      const photoFile = doorPhoto;
      let body: BodyInit;
      let headers: HeadersInit | undefined;
      // Either attachment forces multipart: the bytes stream up instead of
      // being inflated to base64 in the browser.
      if (voiceFile || photoFile) {
        const form = new FormData();
        form.append("specialistId", specialistId);
        form.append("driverId", driverId);
        form.append("tripType", tripType);
        form.append("customerLocation", customerLocation.trim());
        form.append("driverMessage", finalDriverMessage.trim());
        form.append("specialistMessage", specialistMessage.trim());
        form.append("expectedVersion", String(order.version));
        form.append("idempotencyKey", crypto.randomUUID());
        form.append("specialistNote", noteMode === "text" ? specialistNote : "");
        if (voiceFile) form.append("specialistVoice", voiceFile, voiceFile.name);
        if (photoFile) form.append("doorPhoto", photoFile, photoFile.name);
        body = form;
      } else {
        headers = { "Content-Type": "application/json" };
        body = JSON.stringify({
          specialistId,
          driverId,
          tripType,
          customerLocation: customerLocation.trim(),
          specialistNote: noteMode === "text" ? specialistNote : "",
          driverMessage: finalDriverMessage.trim(),
          specialistMessage: specialistMessage.trim(),
          expectedVersion: order.version,
          idempotencyKey: crypto.randomUUID(),
        });
      }
      const response = await fetch(`/api/orders/${order.id}/dispatch`, {
        method: "POST",
        headers,
        body,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data?.error ?? "تعذّر إسناد الطلب");
        return;
      }
      onUpdated(data.order as DriverOrderRow);
      setResult({
        sent: Boolean(data.sent),
        specialistSent:
          typeof data.specialistSent === "boolean" ? data.specialistSent : null,
        notified: Boolean(data.notified),
      });
    } catch {
      setError("تعذّر إسناد الطلب");
    } finally {
      setSubmitting(false);
    }
  }, [
    confirmed,
    customerLocation,
    doorPhoto,
    driverId,
    finalDriverMessage,
    noteMode,
    onUpdated,
    order.id,
    order.version,
    reviewing,
    specialistMessage,
    specialistId,
    specialistNote,
    tripType,
    voiceNote,
  ]);

  const review = useCallback(async () => {
    setError(null);
    if (isLocationUnset(customerLocation)) return setError(LOCATION_REQUIRED);
    if (!specialistId) return setError("اختاري الأخصائية");
    if (!driverId) return setError("اختاري السائق");
    if (!driverMessage.trim()) return setError(DRIVER_MESSAGE_REQUIRED);

    setPreviewing(true);
    try {
      const response = await fetch(`/api/orders/${order.id}/dispatch/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          specialistId,
          driverId,
          tripType,
          customerLocation: customerLocation.trim(),
          specialistNote: noteMode === "text" ? specialistNote : "",
          driverMessage: driverMessage.trim(),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data?.error ?? "تعذّر تجهيز الرسائل النهائية");
        return;
      }
      setFinalDriverMessage(data.preview.driverMessage);
      setSpecialistMessage(data.preview.specialistMessage);
      setPreviewLanguage(data.preview.specialistLanguage ?? language);
      setAutomaticAdditions(data.preview.automaticAdditions ?? []);
      setConfirmed(false);
      setReviewing(true);
    } catch {
      setError("تعذّر تجهيز الرسائل النهائية");
    } finally {
      setPreviewing(false);
    }
  }, [
    driverId,
    customerLocation,
    driverMessage,
    language,
    noteMode,
    order.id,
    specialistId,
    specialistNote,
    tripType,
  ]);

  return (
    <>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>تأكيد الحجز وإسناد السائق</DialogTitle>
          <DialogDescription>
            {result
              ? "اكتملت معالجة الطلب."
              : "بيانات الحجز مأخوذة من ركاز. راجعي الأخصائية والسائق والملاحظات ثم أسندي الطلب."}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="flex flex-col gap-4">
            <Alert>
              <CheckCircle2 />
              <AlertTitle>تم إسناد الطلب للسائق والأخصائية</AlertTitle>
              <AlertDescription>
                الطلب وملاحظاته ظاهران الآن في تطبيق كلٍّ منهما.
              </AlertDescription>
            </Alert>
            {/* The order is in both apps the moment it is assigned — that part
                cannot fail. Only the two nudges can, so each is reported on its
                own and neither is described as a failed order. */}
            {result.sent ? null : (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertTitle>لم تصل نسخة واتساب للسائق</AlertTitle>
                <AlertDescription>
                  الطلب ظاهر في تطبيقه، لكن رسالة واتساب لم تُرسل. تحققي من ربط
                  واتساب ثم استخدمي «إعادة الإرسال» من البطاقة.
                </AlertDescription>
              </Alert>
            )}
            {result.specialistSent === false ? (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertTitle>لم تصل نسخة واتساب للأخصائية</AlertTitle>
                <AlertDescription>
                  الطلب وملاحظتها ظاهران في تطبيقها؛ راجعي رقمها وربط واتساب.
                </AlertDescription>
              </Alert>
            ) : null}
            {result.notified ? null : (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertTitle>لم يصل تنبيه التطبيق</AlertTitle>
                <AlertDescription>
                  الطلب موجود في تطبيقهما، لكن التنبيه لم يصل لأي جهاز. تأكدي من
                  تسجيل دخولهما للتطبيق، أو استخدمي «إعادة الإرسال» من البطاقة.
                </AlertDescription>
              </Alert>
            )}
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
              {/* First, and gating everything after it. A booking raised from
                  ركاز carries no address, and the placeholder used to travel
                  into the driver's instructions as though it were a place.
                  Disabling the roster is not the rule — the command refuses a
                  blank address too — it is what makes the order obvious. */}
              <Field data-invalid={locationMissing && Boolean(error)}>
                <FieldLabel htmlFor={`dispatch-location-${order.id}`}>
                  موقع العميلة
                </FieldLabel>
                <Input
                  id={`dispatch-location-${order.id}`}
                  value={customerLocation}
                  onChange={(event) => {
                    setCustomerLocation(event.target.value);
                    setDriverMessage(
                      initialDriverMessage(
                        order,
                        selectedSpecialist?.full_name ?? null,
                        tripType,
                        event.target.value
                      )
                    );
                    setConfirmed(false);
                    setReviewing(false);
                  }}
                  maxLength={500}
                  placeholder="الحي والشارع، أو رابط الموقع من واتساب"
                  className="min-h-11"
                  aria-invalid={locationMissing && Boolean(error)}
                />
                <FieldDescription>
                  {locationMissing
                    ? "لا يمكن اختيار الأخصائية والسائق قبل تحديد الموقع."
                    : "هذا هو العنوان الذي سيصل السائق إليه."}
                </FieldDescription>
              </Field>

              {/* A pin puts the driver on the street; the photo tells him which
                  gate. Optional — most orders will not have one, and a missing
                  photo must never hold up a dispatch. */}
              <Field>
                <FieldLabel htmlFor={`dispatch-door-${order.id}`}>
                  صورة باب العميلة (اختياري)
                </FieldLabel>
                <Input
                  id={`dispatch-door-${order.id}`}
                  type="file"
                  accept="image/*"
                  className="min-h-11"
                  onChange={(event) => {
                    setDoorPhoto(event.target.files?.[0] ?? null);
                    setConfirmed(false);
                  }}
                />
                <FieldDescription>
                  {doorPhoto
                    ? `${doorPhoto.name} — ستصل للسائق مع طلبه.`
                    : "إن كان عندك صورة للباب أو المدخل، أرفقيها للسائق."}
                </FieldDescription>
              </Field>

              <Field data-invalid={!specialistId && Boolean(error)}>
                <FieldLabel htmlFor={`dispatch-specialist-${order.id}`}>
                  الأخصائية
                </FieldLabel>
                <Select
                  value={specialistId}
                  onValueChange={requestSpecialistChange}
                >
                  <SelectTrigger
                    id={`dispatch-specialist-${order.id}`}
                    className="min-h-11 w-full"
                    disabled={locationMissing}
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
                      "الأخصائية المختارة بدون رقم — الرقم هو وسيلة دخولها للتطبيق."
                    )
                  ) : preferredSpecialistName ? (
                    `لم نجد «${preferredSpecialistName}» في قائمة الأخصائيات؛ اختاريها يدويًا.`
                  ) : (
                    "اختاري الأخصائية المسجلة على الحجز."
                  )}
                </FieldDescription>
              </Field>

              {preferredSpecialistName && selectedSpecialist && !specialistMatchesRekaz ? (
                <Alert variant="destructive">
                  <AlertTriangle />
                  <AlertTitle>الأخصائية مختلفة عن حجز ركاز</AlertTitle>
                  <AlertDescription>
                    ركاز مسجل عليه «{preferredSpecialistName}»، والمختارة الآن «
                    {selectedSpecialist.full_name}». راجعي الحجز قبل الإرسال.
                  </AlertDescription>
                </Alert>
              ) : null}

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
                      onChange={(event) => {
                        setSpecialistNote(event.target.value);
                        setReviewing(false);
                        setConfirmed(false);
                      }}
                      maxLength={500}
                      placeholder="تعليمات إضافية فقط…"
                      className="min-h-20"
                    />
                    <FieldDescription>
                      تفاصيل الحجز الأساسية ستظهر لها تلقائيًا باللغة {language}.
                    </FieldDescription>
                  </>
                ) : (
                  <VoiceNoteRecorder
                    value={voiceNote}
                    onChange={setVoiceNote}
                    disabled={submitting}
                    description={`تفاصيل الحجز ستظهر مكتوبة باللغة ${language}، والتسجيل الصوتي اختياري وتسمعه من التطبيق.`}
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
                        nextTripType,
                        customerLocation
                      )
                    );
                    setConfirmed(false);
                    setReviewing(false);
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
                <Select
                  value={driverId}
                  onValueChange={(value) => {
                    setDriverId(value);
                    setReviewing(false);
                    setConfirmed(false);
                  }}
                >
                  <SelectTrigger
                    id={`dispatch-driver-${order.id}`}
                    className="min-h-11 w-full"
                    disabled={locationMissing}
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
                  ملاحظة السائق
                </FieldLabel>
                <Textarea
                  id={`driver-message-${order.id}`}
                  value={driverMessage}
                  onChange={(event) => {
                    setDriverMessage(event.target.value);
                    setConfirmed(false);
                    setReviewing(false);
                  }}
                  maxLength={3000}
                  className="min-h-52 leading-7"
                  aria-invalid={!driverMessage.trim() && Boolean(error)}
                />
                <FieldDescription>
                  يمكنك تعديل النص قبل إظهاره لـ{" "}
                  {selectedDriver?.full_name ?? "السائق المختار"} في تطبيقه، مع
                  خطوات تأكيد بداية الرحلة ونهايتها.
                </FieldDescription>
              </Field>

              {reviewing ? (
                <>
                  <Alert>
                    <MessageSquareText />
                    <AlertTitle>الملاحظات النهائية قبل الإرسال</AlertTitle>
                    <AlertDescription>
                      عدّلي النصين هنا. سيظهر النص كما هو في تطبيق السائق
                      والأخصائية، وسيصلهما أيضًا نسخة على واتساب.
                    </AlertDescription>
                  </Alert>

                  <Field data-invalid={!finalDriverMessage.trim() && Boolean(error)}>
                    <FieldLabel htmlFor={`final-driver-message-${order.id}`}>
                      ملاحظة السائق النهائية
                    </FieldLabel>
                    <Textarea
                      id={`final-driver-message-${order.id}`}
                      value={finalDriverMessage}
                      onChange={(event) => {
                        setFinalDriverMessage(event.target.value);
                        setConfirmed(false);
                      }}
                      maxLength={3000}
                      className="min-h-52 leading-7"
                    />
                  </Field>

                  <Field data-invalid={!specialistMessage.trim() && Boolean(error)}>
                    <FieldLabel htmlFor={`final-specialist-message-${order.id}`}>
                      ملاحظة الأخصائية النهائية · {previewLanguage}
                    </FieldLabel>
                    <Textarea
                      id={`final-specialist-message-${order.id}`}
                      value={specialistMessage}
                      onChange={(event) => {
                        setSpecialistMessage(event.target.value);
                        setConfirmed(false);
                      }}
                      maxLength={3000}
                      className="min-h-52 leading-7"
                    />
                    {automaticAdditions.length ? (
                      <FieldDescription>
                        الإضافات التلقائية الظاهرة: {automaticAdditions.join(" · ")}
                      </FieldDescription>
                    ) : null}
                  </Field>

                  {noteMode === "voice" && voiceNote ? (
                    <VoiceNoteRecorder
                      value={voiceNote}
                      onChange={setVoiceNote}
                      disabled={submitting}
                      description="شغّلي التسجيل وراجعيه؛ ستسمعه الأخصائية في تطبيقها وعلى واتساب بعد الملاحظة المكتوبة."
                    />
                  ) : null}
                </>
              ) : null}

              {reviewing ? (
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
                        راجعت النص النهائي للسائق والأخصائية
                      </FieldLabel>
                    </FieldTitle>
                    <FieldDescription>
                      أؤكد إظهار النصين والتسجيل الصوتي في تطبيقهما كما هي أعلاه.
                    </FieldDescription>
                  </FieldContent>
                </Field>
              ) : null}
              {error ? <FieldError>{error}</FieldError> : null}
            </FieldGroup>

            <DialogFooter>
              <Button variant="outline" onClick={() => changeOpen(false)}>
                إلغاء
              </Button>
              <Button
                onClick={reviewing ? send : review}
                disabled={
                  submitting || previewing || locationMissing || (reviewing && !confirmed)
                }
              >
                {submitting || previewing ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <Send data-icon="inline-start" />
                )}
                {submitting
                  ? "جارٍ الإسناد…"
                  : previewing
                    ? "جارٍ تجهيز الملاحظات…"
                    : reviewing
                      ? "تأكيد وإسناد"
                      : "تجهيز الملاحظات ومراجعتها"}
              </Button>
            </DialogFooter>
          </>
        )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(pendingSpecialistId)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setPendingSpecialistId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>تغيير الأخصائية؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم تغيير الأخصائية من «{selectedSpecialist?.full_name ?? "—"}» إلى «
              {pendingSpecialist?.full_name ?? "—"}». تأكدي أن هذا التغيير مطابق لحجز ركاز.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingSpecialistId(null)}>
              إبقاء {selectedSpecialist?.full_name ?? "الأخصائية الحالية"}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingSpecialistId) applySpecialist(pendingSpecialistId);
                setPendingSpecialistId(null);
              }}
            >
              تغيير إلى {pendingSpecialist?.full_name ?? "الأخصائية الجديدة"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
