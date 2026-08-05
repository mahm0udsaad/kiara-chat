import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { findOrCreateConversation } from "@/lib/server-conversations";

/**
 * POST /api/reservations/conversation — the thread behind a Rekaz reservation.
 *
 * Driver orders hang off a conversation, but a Rekaz booking may belong to a
 * customer who never wrote on WhatsApp. طلب سائق from the schedule needs a
 * conversation to attach the order to, so this finds the customer's thread or
 * starts an empty one — reusing the ingest path's find-or-create, name filled
 * only if the thread has none.
 */
export async function POST(request: Request) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const digits = String(body?.phone ?? "").replace(/\D/g, "");
  if (digits.length < 8) {
    return NextResponse.json({ error: "رقم الزبونة غير صحيح" }, { status: 400 });
  }
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 80) : null;

  try {
    const conv = await findOrCreateConversation(`+${digits}`, name || null);
    return NextResponse.json({ ok: true, conversationId: conv.id });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "تعذّر تجهيز المحادثة" },
      { status: 500 }
    );
  }
}
