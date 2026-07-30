/**
 * The bot's schedule shape and the pure logic over it. Kept free of any DB or
 * server import so the settings screen (a client component) can render and
 * describe a window without dragging the service-role client into the browser
 * bundle — see @/lib/ai-settings for the reads and writes.
 */

export const DEFAULT_BOT_TIMEZONE = "Asia/Riyadh";

export interface BotSettings {
  /** Master switch — off means the bot never answers, schedule or not. */
  enabled: boolean;
  /** Off means "no window at all", i.e. the bot may answer around the clock. */
  scheduleEnabled: boolean;
  /** "HH:MM" in `timezone`. start === end is a full 24h day. */
  start: string;
  end: string;
  /** Run all day on Friday/Saturday regardless of the window. */
  weekend24h: boolean;
  timezone: string;
}

/** "HH:MM" / "HH:MM:SS" → minutes past midnight, or null when unparseable. */
export function parseTimeToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Weekday (0=Sun..6=Sat) and minutes past midnight, read in `timeZone`. */
function localParts(now: Date, timeZone: string): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekdays: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    weekday: weekdays[get("weekday")] ?? now.getUTCDay(),
    // Intl can render midnight as "24" under hour12:false.
    minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")),
  };
}

/** Friday and Saturday — the Saudi weekend. */
export function isWeekend(weekday: number): boolean {
  return weekday === 5 || weekday === 6;
}

/**
 * Whether the bot may answer right now. Mirrors the parent app's
 * `isAiWithinSchedule` so both products read the same columns the same way:
 * every ambiguous case fails OPEN, because a misconfigured window silently
 * muting the bot is worse than one that answers a few minutes early.
 */
export function isWithinSchedule(
  settings: Pick<
    BotSettings,
    "scheduleEnabled" | "start" | "end" | "weekend24h" | "timezone"
  >,
  now: Date = new Date()
): boolean {
  if (!settings.scheduleEnabled) return true;

  let local: { weekday: number; minutes: number };
  try {
    local = localParts(now, settings.timezone || DEFAULT_BOT_TIMEZONE);
  } catch {
    return true; // bad timezone string
  }

  if (settings.weekend24h && isWeekend(local.weekday)) return true;

  const start = parseTimeToMinutes(settings.start);
  const end = parseTimeToMinutes(settings.end);
  if (start === null || end === null) return true;

  // 00:00 → 00:00 (or any equal pair) means "all day", which is how Kiara runs.
  if (start === end) return true;

  if (start < end) return local.minutes >= start && local.minutes <= end;
  // Overnight window, e.g. 22:00 → 06:00.
  return local.minutes >= start || local.minutes <= end;
}

/** Human-readable window for the settings screen. */
export function describeSchedule(settings: BotSettings): string {
  if (!settings.enabled) return "البوت متوقف — لا يرد على أحد.";
  if (!settings.scheduleEnabled) return "يعمل على مدار الساعة، كل أيام الأسبوع.";
  if (settings.start === settings.end)
    return `يعمل ٢٤ ساعة يوميًا (${settings.start} إلى ${settings.end}).`;
  const base = `يعمل يوميًا من ${settings.start} إلى ${settings.end}`;
  return settings.weekend24h
    ? `${base}، و٢٤ ساعة يومي الجمعة والسبت.`
    : `${base}.`;
}
