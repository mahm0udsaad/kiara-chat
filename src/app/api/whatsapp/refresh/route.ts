import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { refreshEngineQr } from "@/lib/transport/openwa";
import { engineConfigFor } from "@/lib/whatsapp-senders";
import { parseSenderId } from "@/lib/whatsapp-senders-core";

/** POST ?engine=<sender id> — a fresh QR for that number; no param = orders number. */
export async function POST(request: Request) {
  const session = await getKiaraSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const raw = new URL(request.url).searchParams.get("engine");
  const engine = raw ? engineConfigFor(parseSenderId(raw) ?? "") : undefined;
  if (raw && !engine) {
    return NextResponse.json({ error: "Unknown engine" }, { status: 400 });
  }
  try {
    await refreshEngineQr(engine ?? undefined);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}
