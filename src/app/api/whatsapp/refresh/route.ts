import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { refreshEngineQr } from "@/lib/transport/openwa";

export async function POST() {
  const session = await getKiaraSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    await refreshEngineQr();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}
