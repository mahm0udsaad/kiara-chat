import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { getEngineState } from "@/lib/transport/openwa";
import { getTwilioSenderStatus } from "@/lib/transport/twilio";
import { customerProvider, inboxProvider } from "@/lib/transport";
import { getMetaSenderStatus } from "@/lib/transport/meta";

/** Connection health and the active inbox provider. */
export async function GET() {
  const session = await getKiaraSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const [openwa, twilio, meta] = await Promise.all([
    getEngineState(),
    Promise.resolve(getTwilioSenderStatus()),
    Promise.resolve(getMetaSenderStatus()),
  ]);
  return NextResponse.json({ openwa, twilio, meta, customerProvider: customerProvider(), inboxProvider: inboxProvider() });
}
