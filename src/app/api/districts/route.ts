import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import {
  createDistrict,
  DistrictError,
  listDistricts,
  parseDistrictName,
  parseTripPrice,
} from "@/lib/districts";

/**
 * Every employee picks a district on an order, so every employee reads the
 * list. Fares, and the archived rows the management screen needs, are
 * admin-only.
 */
export async function GET() {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const isAdmin = session.role === "admin";
  try {
    const districts = await listDistricts({ activeOnly: !isAdmin, withPrice: isAdmin });
    return NextResponse.json({ districts });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "تعذّر تحميل الأحياء" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "إدارة الأحياء للمالكة والمديرة فقط" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  try {
    const district = await createDistrict(session.userId, {
      name: parseDistrictName(body?.name),
      tripPrice: parseTripPrice(body?.tripPrice),
    });
    return NextResponse.json({ ok: true, district });
  } catch (error) {
    if (error instanceof DistrictError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "تعذّر إضافة الحي" },
      { status: 500 },
    );
  }
}
