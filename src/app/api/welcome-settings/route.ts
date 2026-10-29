import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { getWelcomeSettings, saveWelcomeSettings } from "@/lib/welcome-message";

/** WhatsApp rejects a text body over 4096 characters. */
const MAX_LENGTH = 4096;

/** The welcome message is owner/manager-only, like the bot it sits beside. */
export async function GET() {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ settings: await getWelcomeSettings() });
}

export async function PUT(request: Request) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const text = String(body?.text ?? "").trim();
  const enabled = Boolean(body?.enabled);
  if (enabled && !text)
    return NextResponse.json({ error: "اكتبي نص الرسالة قبل التشغيل" }, { status: 400 });
  if (text.length > MAX_LENGTH)
    return NextResponse.json({ error: "الرسالة أطول من حد واتساب (٤٠٩٦ حرفًا)" }, { status: 400 });

  try {
    const settings = await saveWelcomeSettings({ enabled, text });
    return NextResponse.json({ ok: true, settings });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "تعذّر حفظ رسالة الترحيب" },
      { status: 500 }
    );
  }
}
