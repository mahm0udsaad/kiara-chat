import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { listDrivers, createDriver } from "@/lib/dispatch";

export async function GET() {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ drivers: await listDrivers() });
}

export async function POST(request: Request) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const fullName = (body?.fullName as string | undefined)?.trim();
  const phone = (body?.phone as string | undefined)?.trim();
  if (!fullName) return NextResponse.json({ error: "الاسم مطلوب" }, { status: 400 });
  if (!phone) return NextResponse.json({ error: "رقم السائق مطلوب" }, { status: 400 });

  try {
    const driver = await createDriver(session.userId, fullName, phone);
    return NextResponse.json({ ok: true, driver });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to create driver" },
      { status: 500 }
    );
  }
}
