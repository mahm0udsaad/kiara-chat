import { NextResponse } from "next/server";

import { recordEmployeeAppPresence } from "@/lib/app-presence";
import { getKiaraSession } from "@/lib/tenant";

export async function POST(request: Request) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.teamMemberId) {
    return NextResponse.json({ error: "Team member required" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as { state?: unknown } | null;
  const state = body?.state === "background" ? "background" : "active";
  try {
    await recordEmployeeAppPresence({ session, state, platform: "web" });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[app-presence]", error);
    return NextResponse.json({ error: "Heartbeat failed" }, { status: 500 });
  }
}
