import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { getEngineState } from "@/lib/transport/openwa";
import { getTwilioSenderStatus } from "@/lib/transport/twilio";

/**
 * GET /api/whatsapp/state — the health of both numbers.
 *
 * Kiara sends on two, and they fail in completely different ways: the linked
 * device can silently drop its session and need re-pairing, while the Business
 * Platform sender either is registered or is not. The Connect page has to show
 * both, because "WhatsApp is down" is never true of the pair at once.
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
