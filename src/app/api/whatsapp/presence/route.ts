import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { listConversations } from "@/lib/inbox";
import { isOpenWaConfigured, watchPresence } from "@/lib/transport/openwa";

/** Enough to cover what any dashboard actually shows without flooding WhatsApp. */
const WATCH_LIMIT = 100;

/**
 * POST /api/whatsapp/presence — subscribe the engine to typing indicators for
 * the conversations this session can see.
 *
 * Called when the inbox mounts: presence subscriptions live on the WhatsApp
 * socket, so an engine restart silently drops them and the indicators would
 * just stop appearing with nothing to show why.
 */
export async function POST() {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isOpenWaConfigured()) return NextResponse.json({ ok: true, watched: 0 });

  try {
    const conversations = await listConversations(WATCH_LIMIT, {
      isAdmin: session.role === "admin",
      teamMemberId: session.teamMemberId,
    });
    const phones = [...new Set(conversations.map((c) => c.customer_phone))];
    await watchPresence(phones);
    return NextResponse.json({ ok: true, watched: phones.length });
  } catch (e) {
    // The inbox works fine without indicators; never surface this as a failure.
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 200 }
    );
  }
}
