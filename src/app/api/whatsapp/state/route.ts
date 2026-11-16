import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { getEngineState } from "@/lib/transport/openwa";
import { getTwilioSenderStatus } from "@/lib/transport/twilio";
import { customerProvider, inboxProvider } from "@/lib/transport";
import { getMetaSenderStatus } from "@/lib/transport/meta";
import { linkedSenderStates } from "@/lib/whatsapp-senders";

/** Connection health and the active inbox provider. */
export async function GET() {
  const session = await getKiaraSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const [openwa, twilio, meta, linkedSenders] = await Promise.all([
    getEngineState(),
    Promise.resolve(getTwilioSenderStatus()),
    Promise.resolve(getMetaSenderStatus()),
    // Customer-facing OpenWA numbers, each with its own QR. A failure here
    // must not hide the orders number's card.
    linkedSenderStates().catch(() => []),
  ]);
  return NextResponse.json({
    openwa,
    twilio,
    meta,
    linkedSenders,
    customerProvider: customerProvider(),
    inboxProvider: inboxProvider(),
  });
}
