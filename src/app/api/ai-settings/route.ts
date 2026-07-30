import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { getBotSettings, saveBotSettings } from "@/lib/ai-settings";
import { DEFAULT_BOT_TIMEZONE, parseTimeToMinutes } from "@/lib/bot-schedule";

/** The bot switch and its schedule are owner/manager-only. */
export async function GET() {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ settings: await getBotSettings() });
}

export async function PUT(request: Request) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const start = String(body?.start ?? "");
  const end = String(body?.end ?? "");
  if (parseTimeToMinutes(start) === null || parseTimeToMinutes(end) === null)
    return NextResponse.json({ error: "صيغة الوقت غير صحيحة" }, { status: 400 });

  const timezone = String(body?.timezone ?? "").trim() || DEFAULT_BOT_TIMEZONE;
  try {
    // Reject a timezone Intl can't resolve — storing it would make the schedule
    // fail open forever with no visible reason.
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    return NextResponse.json({ error: "المنطقة الزمنية غير معروفة" }, { status: 400 });
  }

  try {
    const settings = await saveBotSettings({
      enabled: Boolean(body?.enabled),
      scheduleEnabled: Boolean(body?.scheduleEnabled),
      start,
      end,
      weekend24h: Boolean(body?.weekend24h),
      timezone,
    });
    return NextResponse.json({ ok: true, settings });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "تعذّر حفظ إعدادات البوت" },
      { status: 500 }
    );
  }
}
