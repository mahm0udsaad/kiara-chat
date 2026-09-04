import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { getTwilioSenderStatus } from "@/lib/transport/twilio";

/**
 * GET /api/whatsapp/state — the health of the number Kiara sends on.
 *
 * There used to be two, and this route reported both because they failed in
 * completely different ways. The linked device is retired (2026-09-04), so the
 * Business Platform sender is the whole answer: it is either registered or it
 * is not, and there is no session to re-pair.
 */
export async function GET() {
  const session = await getKiaraSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ twilio: getTwilioSenderStatus() });
}
