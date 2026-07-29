import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { getDispatchSettings, saveDispatchSettings } from "@/lib/dispatch";

/** Dispatch prices are owner/manager-only — agents get 403 (RLS backs this up). */
export async function GET() {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ settings: await getDispatchSettings() });
}

export async function PUT(request: Request) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const full = Number(body?.fullTripPrice);
  const half = Number(body?.halfTripPrice);
  if (!Number.isFinite(full) || full < 0 || !Number.isFinite(half) || half < 0)
    return NextResponse.json({ error: "السعر غير صحيح" }, { status: 400 });

  try {
    const settings = await saveDispatchSettings(session.userId, {
      fullTripPrice: full,
      halfTripPrice: half,
    });
    return NextResponse.json({ ok: true, settings });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "تعذّر حفظ الأسعار" },
      { status: 500 }
    );
  }
}
