"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { arSA } from "date-fns/locale";
import {
  CalendarCheck2,
  CheckCircle2,
  Clock3,
  MapPin,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import { formatRelativeTime } from "@/lib/format";
import type { SharedLocation, SharedLocationSource } from "@/lib/location";
import type { BookingRequest, DriverOrderRow, TripType } from "@/lib/types";

const SHARED_LABEL: Record<SharedLocationSource, string> = {
  pin: "موقع أرسلته الزبونة",
  link: "رابط خريطة من المحادثة",
  text: "آخر عنوان كتبته الزبونة",
};

const DURATION_PRESETS = [30, 45, 60, 90, 120] as const;
const TIME_OPTIONS = Array.from({ length: 29 }, (_, index) => {
  const minutes = 8 * 60 + index * 30;
  const hour = String(Math.floor(minutes / 60)).padStart(2, "0");
  const minute = String(minutes % 60).padStart(2, "0");
  return `${hour}:${minute}`;
});

function roundedDefault(): Date {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setMinutes(Math.ceil(date.getMinutes() / 30) * 30, 0, 0);
  if (date.getHours() < 8) {
    date.setHours(8, 0, 0, 0);
  } else if (date.getHours() > 22) {
    date.setDate(date.getDate() + 1);
    date.setHours(8, 0, 0, 0);
  }
  return date;
}

function timeOf(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`;
}

function startOfToday(): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

/**
 * What the location field starts as. A pin or a maps link she shared IS the
 * address, so it outranks the line the bot wrote down and fills the field; a
 * line she typed is only a guess, so it stays a suggestion to accept by hand.
 */
function initialLocation(
  booking: BookingRequest | null,
  shared: SharedLocation | null,
  suggested: string | null
): string {
  return (
    (shared && shared.source !== "text" ? shared.value : "") ||
    booking?.location?.trim() ||
    suggested?.trim() ||
    ""
  );
}

/**
 * The time <Select> only offers half-hour steps 08:00–22:00, so a prefilled
 * arrival (a Rekaz booking at 22:15, say) snaps to the nearest offered slot.
 * The booking alert shows the exact original time for the eye to check.
 */
function snapToTimeOptions(date: Date): string {
  const minutes = date.getHours() * 60 + date.getMinutes();
  const snapped = Math.min(22 * 60, Math.max(8 * 60, Math.round(minutes / 30) * 30));
  return `${String(Math.floor(snapped / 60)).padStart(2, "0")}:${String(
    snapped % 60
  ).padStart(2, "0")}`;
}

export function CreateOrderSheet({
  open,
  onClose,
  conversationId,
  suggestedLocation = null,
  sharedLocation = null,
  booking = null,
  initialArrival = null,
  initialDurationMinutes = null,
  onOrderCreated,
  continueToDispatch = false,
}: {
  open: boolean;
  onClose: () => void;
  conversationId: string;
  suggestedLocation?: string | null;
  /** Whatever location the customer already shared in this thread. */
  sharedLocation?: SharedLocation | null;
  booking?: BookingRequest | null;
  /** ISO — seeds the calendar/time instead of "an hour from now" (Rekaz flow). */
  initialArrival?: string | null;
  initialDurationMinutes?: number | null;
  onOrderCreated?: (order: DriverOrderRow) => void;
  /** Close immediately after saving so the caller can open dispatch in-place. */
  continueToDispatch?: boolean;
}) {
  const router = useRouter();
  const initialDate = useCallback((): Date => {
    if (initialArrival) {
      const d = new Date(initialArrival);
      if (!Number.isNaN(d.getTime())) return d;
    }
    return roundedDefault();
  }, [initialArrival]);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(() =>
    initialDate()
  );
  const [selectedTime, setSelectedTime] = useState(() =>
    initialArrival ? snapToTimeOptions(initialDate()) : timeOf(roundedDefault())
  );
  const [location, setLocation] = useState(() =>
    initialLocation(booking, sharedLocation, suggestedLocation)
  );
  // A prefilled session length snaps to the nearest preset chip — the chips
  // are the only control, and 95 minutes would leave nothing selected.
  const snapDuration = useCallback((): string => {
    if (!initialDurationMinutes) return "60";
    const nearest = [...DURATION_PRESETS].reduce((best, preset) =>
      Math.abs(preset - initialDurationMinutes) < Math.abs(best - initialDurationMinutes)
        ? preset
        : best
    );
    return String(nearest);
  }, [initialDurationMinutes]);
  const [duration, setDuration] = useState(() => snapDuration());
  // A visit is a round trip unless the employee says otherwise; one-way is
  // the exception, and the edit sheet is where it gets set.
  const [tripType, setTripType] = useState<TripType>("round_trip");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const reset = useCallback(() => {
    const next = initialDate();
    setSelectedDate(next);
    setSelectedTime(initialArrival ? snapToTimeOptions(next) : timeOf(next));
    setLocation(initialLocation(booking, sharedLocation, suggestedLocation));
    setDuration(snapDuration());
    setTripType("round_trip");
    setSubmitting(false);
    setError(null);
    setDone(false);
  }, [booking, sharedLocation, suggestedLocation, initialArrival, initialDate, snapDuration]);

  const closeDialog = useCallback(() => {
    reset();
    onClose();
  }, [onClose, reset]);

  // The sheet mounts with the conversation, long before it opens, so a pin
  // that lands in the meantime would otherwise be missed. Re-seed once per
  // opening — never while it is open, which would wipe what was typed.
  const seeded = useRef(false);
  useEffect(() => {
    if (!open) {
      seeded.current = false;
      return;
    }
    if (seeded.current) return;
    seeded.current = true;
    reset();
  }, [open, reset]);

  const usingShared =
    Boolean(sharedLocation) && location.trim() === sharedLocation?.value.trim();

  const submit = useCallback(async () => {
    setError(null);
    if (!selectedDate) {
      setError("اختاري تاريخ الحجز");
      return;
    }
    if (!selectedTime) {
      setError("اختاري وقت الحجز");
      return;
    }
    if (!location.trim()) {
      setError("موقع الزبونة مطلوب");
      return;
    }

    const [hour, minute] = selectedTime.split(":").map(Number);
    const arrival = new Date(selectedDate);
    arrival.setHours(hour, minute, 0, 0);

    setSubmitting(true);
    try {
      const response = await fetch(`/api/conversations/${conversationId}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          arrivalAt: arrival.toISOString(),
          customerLocation: location.trim(),
          durationMinutes: Number(duration),
          tripType,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data?.error ?? "تعذّر إنشاء الحجز");
        return;
      }
      const created = {
        ...(data.order as DriverOrderRow),
        specialist_name: null,
        driver_name: null,
        driver_phone: null,
        customer_name: null,
        updated_by_name: null,
      } satisfies DriverOrderRow;
      onOrderCreated?.(created);
      if (continueToDispatch) {
        closeDialog();
      } else {
        setDone(true);
      }
    } catch {
      setError("تعذّر إنشاء الحجز");
    } finally {
      setSubmitting(false);
    }
  }, [
    selectedDate,
    selectedTime,
    location,
    conversationId,
    duration,
    tripType,
    onOrderCreated,
    continueToDispatch,
    closeDialog,
  ]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) closeDialog();
      }}
    >
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        {done ? (
          <>
            <DialogHeader>
              <DialogTitle>تم إنشاء الحجز</DialogTitle>
              <DialogDescription>
                أضيف الموعد إلى صفحة الطلبات، ويمكن اختيار الأخصائية والسائق من
                هناك عند طلب السائق.
              </DialogDescription>
            </DialogHeader>
            <Alert>
              <CheckCircle2 />
              <AlertTitle>الحجز جاهز</AlertTitle>
              <AlertDescription>
                بقيت خطوة إرسال تفاصيل الموعد للأخصائية والسائق.
              </AlertDescription>
            </Alert>
            <DialogFooter>
              <Button variant="outline" onClick={closeDialog}>
                إغلاق
              </Button>
              <Button
                onClick={() => {
                  closeDialog();
                  router.push("/orders");
                }}
              >
                <CalendarCheck2 data-icon="inline-start" />
                عرض الطلبات
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>حجز موعد</DialogTitle>
              <DialogDescription>
                اختاري اليوم والوقت أولًا. سيُحفظ الموعد الآن، ويمكن طلب السائق
                لاحقًا من صفحة الطلبات.
              </DialogDescription>
            </DialogHeader>

            {booking ? (
              <Alert>
                <CalendarCheck2 />
                <AlertTitle>تفاصيل جمعها المساعد</AlertTitle>
                <AlertDescription>
                  {[booking.service, booking.time, booking.location]
                    .filter(Boolean)
                    .join(" · ") || booking.summary}
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-5 md:grid-cols-[minmax(0,1.15fr)_minmax(260px,0.85fr)]">
              <div className="rounded-xl border bg-card p-2">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  disabled={{ before: startOfToday() }}
                  locale={arSA}
                  className="mx-auto w-full [--cell-size:2.65rem]"
                  captionLayout="dropdown"
                />
              </div>

              <FieldGroup>
                <Field data-invalid={!selectedTime && Boolean(error)}>
                  <FieldLabel htmlFor="booking-time">وقت الموعد</FieldLabel>
                  <Select value={selectedTime} onValueChange={setSelectedTime}>
                    <SelectTrigger
                      id="booking-time"
                      className="min-h-11 w-full"
                      aria-invalid={!selectedTime && Boolean(error)}
                    >
                      <Clock3 data-icon="inline-start" />
                      <SelectValue placeholder="اختاري الوقت" />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      <SelectGroup>
                        {TIME_OPTIONS.map((time) => (
                          <SelectItem key={time} value={time}>
                            {time}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>

                <Field data-invalid={!location.trim() && Boolean(error)}>
                  <FieldLabel htmlFor="booking-location">موقع الزبونة</FieldLabel>
                  <Input
                    id="booking-location"
                    value={location}
                    onChange={(event) => setLocation(event.target.value)}
                    aria-invalid={!location.trim() && Boolean(error)}
                    className="min-h-11"
                    placeholder="الرابط أو العنوان"
                  />
                  {sharedLocation ? (
                    usingShared ? (
                      <FieldDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="inline-flex items-center gap-1 text-[var(--brand)]">
                          <MapPin size={13} aria-hidden="true" />
                          {SHARED_LABEL[sharedLocation.source]}
                          {" · "}
                          {formatRelativeTime(sharedLocation.at)}
                        </span>
                        {sharedLocation.url ? (
                          <a
                            href={sharedLocation.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline underline-offset-2"
                          >
                            فتح على الخريطة
                          </a>
                        ) : null}
                      </FieldDescription>
                    ) : (
                      <div className="rounded-lg border border-dashed bg-muted/40 p-2.5">
                        <div className="flex items-start gap-2">
                          <MapPin
                            size={14}
                            className="mt-0.5 shrink-0 text-[var(--brand)]"
                            aria-hidden="true"
                          />
                          <div className="min-w-0 flex-1 space-y-1">
                            <p className="text-xs font-medium">
                              {SHARED_LABEL[sharedLocation.source]}
                              <span className="whitespace-nowrap font-normal text-muted-foreground">
                                {" · "}
                                {formatRelativeTime(sharedLocation.at)}
                              </span>
                            </p>
                            <p className="line-clamp-2 break-all text-xs text-muted-foreground">
                              {sharedLocation.label || sharedLocation.url}
                            </p>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="shrink-0"
                            onClick={() => setLocation(sharedLocation.value)}
                          >
                            استخدام
                          </Button>
                        </div>
                      </div>
                    )
                  ) : null}
                </Field>

                <Field>
                  <FieldLabel>مدة الجلسة</FieldLabel>
                  <ToggleGroup
                    type="single"
                    value={duration}
                    onValueChange={(value) => value && setDuration(value)}
                    variant="outline"
                    spacing={1}
                    className="flex-wrap"
                    aria-label="مدة الجلسة"
                  >
                    {DURATION_PRESETS.map((minutes) => (
                      <ToggleGroupItem
                        key={minutes}
                        value={String(minutes)}
                        className="min-h-10"
                      >
                        {minutes} د
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </Field>

                <Field>
                  <FieldLabel>نوع الرحلة</FieldLabel>
                  <ToggleGroup
                    type="single"
                    value={tripType}
                    onValueChange={(value) =>
                      value && setTripType(value as TripType)
                    }
                    variant="outline"
                    spacing={1}
                    className="w-full"
                    aria-label="نوع الرحلة"
                  >
                    <ToggleGroupItem
                      value="one_way"
                      className="min-h-10 flex-1"
                    >
                      ذهاب فقط
                    </ToggleGroupItem>
                    <ToggleGroupItem
                      value="round_trip"
                      className="min-h-10 flex-1"
                    >
                      ذهاب وعودة
                    </ToggleGroupItem>
                  </ToggleGroup>
                  <FieldDescription>
                    يمكن تغيير السائق قبل الإرسال من صفحة الطلبات.
                  </FieldDescription>
                </Field>

                {error ? <FieldError>{error}</FieldError> : null}
              </FieldGroup>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={closeDialog}>
                إلغاء
              </Button>
              <Button onClick={submit} disabled={submitting}>
                {submitting ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <CalendarCheck2 data-icon="inline-start" />
                )}
                {submitting ? "جارٍ إنشاء الحجز…" : "تأكيد الحجز"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
