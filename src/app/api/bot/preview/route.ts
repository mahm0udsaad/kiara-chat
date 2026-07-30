import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { previewBotAnswer } from "@/lib/bot/reply";

/**
 * Dry-run the bot: returns the answer it would give, without sending anything
 * to WhatsApp or touching a conversation. Admin-only — it spends model calls.
 */
export async function POST(request: Request) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const question = (body?.question as string | undefined)?.trim();
  if (!question) return NextResponse.json({ error: "اكتبي سؤالًا للتجربة" }, { status: 400 });

  try {
    return NextResponse.json({ ok: true, preview: await previewBotAnswer(question) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "تعذّرت التجربة" },
      { status: 500 }
    );
  }
}
