/**
 * Order times are Riyadh wall-clock times, whatever zone the browser is in.
 * Staff in Egypt matched Riyadh only while Cairo was on summer time; in winter
 * Cairo is an hour behind, so building a time in the browser's zone moves the
 * visit by an hour.
 */
const RIYADH_TZ = "Asia/Riyadh";

const partsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: RIYADH_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function riyadhParts(date: Date) {
  const parts = Object.fromEntries(
    partsFormatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return parts as Record<"year" | "month" | "day" | "hour" | "minute", string>;
}

/** `YYYY-MM-DD` for an `<input type="date">`, on the Riyadh calendar. */
export function riyadhDateInput(date: Date): string {
  const { year, month, day } = riyadhParts(date);
  return `${year}-${month}-${day}`;
}

/** `HH:MM` for an `<input type="time">`, on the Riyadh clock. */
export function riyadhTimeInput(date: Date): string {
  const { hour, minute } = riyadhParts(date);
  return `${hour}:${minute}`;
}

/** The instant a Riyadh date and time box pair describes, or null if incomplete. */
export function riyadhInputsToIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  // Saudi Arabia keeps UTC+3 all year.
  const instant = new Date(`${date}T${time}:00+03:00`);
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}

/**
 * A browser-local Date whose fields read as the Riyadh wall clock, for widgets
 * (calendars, hour lists) that only speak local time. Turn it back into an
 * instant with `riyadhInputsToIso(localDateKey(d), "HH:MM")`.
 */
export function riyadhWallClock(date: Date): Date {
  const { year, month, day, hour, minute } = riyadhParts(date);
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
}

const pad2 = (value: number) => String(value).padStart(2, "0");

/** `YYYY-MM-DD` of a local Date's own fields. */
export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}
