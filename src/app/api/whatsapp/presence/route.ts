import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";

/**
 * POST /api/whatsapp/presence — retired no-op.
 *
 * Typing indicators only ever existed on the linked device: WhatsApp pushes
 * presence to a paired client, and the engine subscribed per chat because those
 * subscriptions die with the socket. The Business Platform exposes no inbound
 * presence at all, so with the engine retired (2026-09-04) there is nothing to
 * subscribe to.
 *
 * The route stays rather than 404ing because the inbox and every installed
 * build of the mobile app call it on mount. A shipped client calling a route
 * that vanished logs an error on every launch for a feature that is simply
 * gone; answering "watched: 0" says the same thing quietly.
 */
export async function POST() {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, watched: 0 });
}
