/**
 * Reading and writing the auto-reply bot's switch and schedule. Server-only —
 * the pure schedule logic lives in @/lib/bot-schedule so client components can
 * share it.
 *
 * Storage is the shared `restaurants` row (`ai_enabled` + the `ai_schedule_*`
 * columns the parent app added in 20260621000000_ai_schedule.sql), so Kiara and
 * Nehgz agree on when the bot may answer instead of each keeping its own copy.
 *
 * Reads/writes go through the service-role client because RLS on `restaurants`
 * only admits the owner — a manager who is a team_member would otherwise get an
 * empty row. Every caller is gated to `session.role === "admin"` in the route.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { DEFAULT_BOT_TIMEZONE, type BotSettings } from "@/lib/bot-schedule";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";

const COLS =
  "ai_enabled, ai_schedule_enabled, ai_schedule_start, ai_schedule_end, ai_schedule_weekend_24h, ai_schedule_timezone";

/** Postgres hands back "HH:MM:SS"; the UI speaks "HH:MM". */
function toHHMM(value: string | null | undefined, fallback: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec((value ?? "").trim());
  if (!m) return fallback;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

export async function getBotSettings(): Promise<BotSettings> {
  const { data, error } = await getAdminSupabaseClient()
    .from("restaurants")
    .select(COLS)
    .eq("id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return {
    enabled: data?.ai_enabled === true,
    scheduleEnabled: data?.ai_schedule_enabled === true,
    start: toHHMM(data?.ai_schedule_start as string | null, "00:00"),
    end: toHHMM(data?.ai_schedule_end as string | null, "00:00"),
    weekend24h: data?.ai_schedule_weekend_24h === true,
    timezone: (data?.ai_schedule_timezone as string | null) || DEFAULT_BOT_TIMEZONE,
  };
}

export async function saveBotSettings(next: BotSettings): Promise<BotSettings> {
  const { error } = await getAdminSupabaseClient()
    .from("restaurants")
    .update({
      ai_enabled: next.enabled,
      ai_schedule_enabled: next.scheduleEnabled,
      ai_schedule_start: next.start,
      ai_schedule_end: next.end,
      ai_schedule_weekend_24h: next.weekend24h,
      ai_schedule_timezone: next.timezone || DEFAULT_BOT_TIMEZONE,
    })
    .eq("id", KIARA_RESTAURANT_ID);
  if (error) throw new Error(error.message);
  return getBotSettings();
}
