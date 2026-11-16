import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { listSendersFor } from "@/lib/whatsapp-senders";

/** GET /api/whatsapp/senders — the business numbers this employee may reply from. */
export async function GET() {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ senders: await listSendersFor(session.role) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "تعذّر تحميل أرقام الإرسال" },
      { status: 500 },
    );
  }
}
