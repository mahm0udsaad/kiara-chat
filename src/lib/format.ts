import type { AgentInfo, TripType } from "@/lib/types";

const rtf = new Intl.RelativeTimeFormat("ar", { numeric: "auto" });

/** Display name for an agent: real name first, then the email local-part. */
export function agentDisplayName(a: AgentInfo | undefined | null): string {
  if (!a) return "موظف";
  if (a.fullName) return a.fullName;
  if (a.email) return a.email.split("@")[0];
  return "موظف";
}

/** "٩٠" → "ساعة ونصف" is too clever; use hours/minutes plainly. */
export function formatDuration(minutes: number): string {
  const n = (v: number) => v.toLocaleString("ar-SA");
  if (minutes < 60) return `${n(minutes)} دقيقة`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = h === 1 ? "ساعة" : h === 2 ? "ساعتان" : `${n(h)} ساعات`;
  if (m === 0) return hours;
  return `${hours} و${n(m)} دقيقة`;
}

/** Arabic labels for the trip direction (shown to the driver; price is not). */
export const TRIP_TYPE_LABEL: Record<TripType, string> = {
  one_way: "ذهاب فقط",
  round_trip: "ذهاب وعودة",
};

/**
 * Riyadh day key (YYYY-MM-DD). The salon's wall-clock decides what "same day"
 * means, not the reader's device.
 */
const DAY_KEY_FMT = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Asia/Riyadh",
});

const DAY_LABEL_FMT = new Intl.DateTimeFormat("ar", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "Asia/Riyadh",
});

export function dayKey(iso: string): string {
  return DAY_KEY_FMT.format(new Date(iso));
}

/** "اليوم" / "أمس" / "الخميس، ٣٠ يوليو" for a thread's day separator. */
export function formatDayLabel(iso: string): string {
  const key = dayKey(iso);
  const now = Date.now();
  if (key === DAY_KEY_FMT.format(new Date(now))) return "اليوم";
  if (key === DAY_KEY_FMT.format(new Date(now - 86_400_000))) return "أمس";
  return DAY_LABEL_FMT.format(new Date(iso));
}

/** Relative Arabic timestamp (e.g. "قبل ٣ دقائق"). */
export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const diffSec = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(Math.round(diffSec), "second");
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (abs < 2592000) return rtf.format(Math.round(diffSec / 86400), "day");
  return new Date(iso).toLocaleDateString("ar");
}
