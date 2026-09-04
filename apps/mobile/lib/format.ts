import type { BookingStage, OrderStatus, TripType } from "@/types/api";

const locale = "ar-EG";

export const formatters = {
  time: new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }),
  weekdayDate: new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }),
  shortDate: new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }),
  dateTime: new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  }),
  fullDateTime: new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  }),
};

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/** Whole days from today — negative for the past, 0 today, 1 tomorrow. */
export function dayOffset(iso: string, now = new Date()) {
  const day = startOfDay(new Date(iso)).getTime();
  const today = startOfDay(now).getTime();
  return Math.round((day - today) / 86_400_000);
}

/** "اليوم" / "غدًا" / "أمس", falling back to a written-out date. */
export function relativeDayLabel(iso: string, now = new Date()) {
  const offset = dayOffset(iso, now);
  if (offset === 0) return "اليوم";
  if (offset === 1) return "غدًا";
  if (offset === -1) return "أمس";
  return formatters.weekdayDate.format(new Date(iso));
}

/**
 * Compact "how long ago" for conversation rows. Anything older than a week
 * falls back to a date, since a count of days stops being useful there.
 */
export function relativeTimeLabel(iso: string, now = new Date()) {
  const diffMinutes = Math.round((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (diffMinutes < 1) return "الآن";
  if (diffMinutes < 60) return `قبل ${diffMinutes} د`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `قبل ${diffHours} س`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays <= 7) return `قبل ${diffDays} ي`;
  return formatters.shortDate.format(new Date(iso));
}

const shortWeekday = new Intl.DateTimeFormat(locale, { weekday: "short" });
const shortNumericDate = new Intl.DateTimeFormat(locale, {
  day: "numeric",
  month: "numeric",
  year: "2-digit",
});

/** Compact timestamp used by messaging lists: time today, then day/date. */
export function conversationListTimeLabel(iso: string, now = new Date()) {
  const offset = dayOffset(iso, now);
  if (offset === 0) return formatters.time.format(new Date(iso));
  if (offset === -1) return "أمس";
  if (offset > -7 && offset < 0) return shortWeekday.format(new Date(iso));
  return shortNumericDate.format(new Date(iso));
}

/** "٩٠ دقيقة" as "ساعة و٣٠ د" — durations read faster in hours past 60m. */
export function durationLabel(minutes: number) {
  if (minutes < 60) return `${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hoursLabel = hours === 1 ? "ساعة" : hours === 2 ? "ساعتان" : `${hours} ساعات`;
  return rest ? `${hoursLabel} و${rest} د` : hoursLabel;
}

/** Groups digits so a long phone number stays scannable. */
export function formatPhone(phone: string) {
  const digits = phone.replace(/[^\d+]/g, "");
  const withoutPlus = digits.startsWith("+") ? digits.slice(1) : digits;
  if (withoutPlus.length < 9) return phone;
  const tail = withoutPlus.slice(-9);
  const country = withoutPlus.slice(0, -9);
  const grouped = `${tail.slice(0, 3)} ${tail.slice(3, 6)} ${tail.slice(6)}`;
  return country ? `+${country} ${grouped}` : grouped;
}

/** Up to two initials for an avatar, falling back to the last phone digits. */
export function initialsOf(name: string | null, phone: string) {
  const trimmed = (name ?? "").trim();
  if (trimmed) {
    const parts = trimmed.split(/\s+/).slice(0, 2);
    return parts.map((part) => [...part][0] ?? "").join("");
  }
  return phone.replace(/\D/g, "").slice(-2) || "؟";
}

/** Stable per-customer hue so the same person keeps the same avatar colour. */
export function avatarHue(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 360;
  }
  return hash;
}

export const orderStatusLabel: Record<OrderStatus, string> = {
  pending: "بانتظار الإرسال",
  sent: "تم الإرسال",
  failed: "فشل الإرسال",
};

export const orderStatusTone: Record<OrderStatus, "warning" | "success" | "danger"> = {
  pending: "warning",
  sent: "success",
  failed: "danger",
};

export const orderStatusIcon: Record<OrderStatus, string> = {
  pending: "clock",
  sent: "checkmark.circle",
  failed: "exclamationmark.triangle",
};

export const tripTypeLabel: Record<TripType, string> = {
  one_way: "ذهاب فقط",
  round_trip: "ذهاب وعودة",
};

export const csStatusLabel = {
  open: "جاري المحادثة",
  waiting: "استفسار",
  resolved: "تم الطلب",
} as const;

export const csStatusTone = {
  open: "info",
  waiting: "warning",
  resolved: "success",
} as const;

export const bookingStageLabel: Record<BookingStage, string> = {
  collecting_details: "استلام بيانات",
  awaiting_confirmation: "انتظار تأكيد الحجز",
  booking_confirmed: "تم تأكيد الحجز",
  invoice_required: "إرفاق الفاتورة",
  in_progress: "قيد التنفيذ",
  completed: "تم التنفيذ",
};

/**
 * The link inside a location, wherever it sits.
 *
 * A location is stored as "label — url" when the customer dropped a pin or the
 * booking carried coordinates. Matching only a string that *starts* with http
 * missed those and searched the maps for the whole line, label and URL
 * together — which finds nothing.
 */
const EMBEDDED_LINK = /https?:\/\/\S+/i;

/**
 * The marker the server writes when a raised Rekaz booking carries no address
 * anywhere — not in Rekaz, not as a pin in her chat. Kept in step with
 * `LOCATION_UNSET` in `src/lib/dispatch.ts`; matched on the prefix so the
 * server can reword the instruction half without breaking the phone.
 */
const LOCATION_UNSET_PREFIX = "لم يُحدد الموقع";

/** Is this order still missing a real address? */
export function isLocationMissing(location: string): boolean {
  return !location.trim() || location.trim().startsWith(LOCATION_UNSET_PREFIX);
}

/** Builds a maps deep link from a pasted URL, a "label — url" line, or an address. */
export function locationUrl(location: string) {
  const embedded = EMBEDDED_LINK.exec(location)?.[0];
  if (embedded) return embedded;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}

/**
 * The readable half of a location, for a row that has its own tap target.
 * Showing the raw maps URL beside the label buys the reader nothing and pushes
 * the part she needs off the end of the line.
 */
export function locationLabel(location: string, fallback = "موقع على الخريطة") {
  const withoutLink = location.replace(EMBEDDED_LINK, "").trim();
  const trimmed = withoutLink.replace(/[—–-]\s*$/, "").trim();
  return trimmed || fallback;
}

export function telUrl(phone: string) {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

export function whatsappUrl(phone: string) {
  return `https://wa.me/${phone.replace(/\D/g, "")}`;
}
