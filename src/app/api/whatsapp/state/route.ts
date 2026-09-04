import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { getEngineState } from "@/lib/transport/openwa";
import { getTwilioSenderStatus } from "@/lib/transport/twilio";

/**
 * GET /api/whatsapp/state — the health of both numbers, each in its own role.
 *
 * They fail in completely different ways and matter for completely different
 * things now: Twilio (+966508421748) either is registered as a Business
 * Platform sender or is not, and its outage means every customer thread goes
 * quiet. The linked device (+966595532435) can silently drop its session and
 * need re-pairing, and its outage means the salon's dispatch notes fall back
 * to app pushes only — the customer side never notices.
 *
 * Both are surfaced because "WhatsApp is down" is never true of the pair at
 * once, and the fix for each is a different person's job.
 */
export async function GET() {
  const session = await getKiaraSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const [openwa, twilio] = await Promise.all([
    getEngineState(),
    Promise.resolve(getTwilioSenderStatus()),
  ]);
  return NextResponse.json({ openwa, twilio });
}
