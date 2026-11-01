/**
 * Order times are Riyadh wall-clock times, whatever zone the phone is set to.
 * Staff in Egypt matched Riyadh only while Cairo was on summer time; in winter
 * Cairo is an hour behind, so reading or building a time in the device's zone
 * moves the visit by an hour.
 */
export const RIYADH_TZ = "Asia/Riyadh";

/** Saudi Arabia keeps UTC+3 all year. */
const RIYADH_OFFSET_MS = 3 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const HALF_HOUR_MS = 30 * 60_000;

/** Days since the epoch on the Riyadh calendar. */
export function riyadhDayNumber(date: Date): number {
  return Math.floor((date.getTime() + RIYADH_OFFSET_MS) / DAY_MS);
}

/** The instant of `minutes` past Riyadh midnight on Riyadh day `dayNumber`. */
function atRiyadhMinutes(dayNumber: number, minutes: number): Date {
  return new Date(dayNumber * DAY_MS + minutes * 60_000 - RIYADH_OFFSET_MS);
}

/** An hour from now, on the half hour, inside the Riyadh working day (08:00–22:00). */
export function roundedBookingDefault(now = new Date()): Date {
  const wholeMinute = Math.floor((now.getTime() + 60 * 60_000) / 60_000) * 60_000;
  const date = new Date(Math.ceil(wholeMinute / HALF_HOUR_MS) * HALF_HOUR_MS);
  const day = riyadhDayNumber(date);
  const hour = new Date(date.getTime() + RIYADH_OFFSET_MS).getUTCHours();
  if (hour < 8) return atRiyadhMinutes(day, 8 * 60);
  if (hour > 22) return atRiyadhMinutes(day + 1, 8 * 60);
  return date;
}
