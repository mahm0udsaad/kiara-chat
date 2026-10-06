import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import {
  deleteDistrict,
  DistrictError,
  parseDistrictName,
  parseTripPrice,
  updateDistrict,
} from "@/lib/districts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function adminSession() {
  const session = await getKiaraSession();
  if (!session) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (session.role !== "admin") {
    return {
      response: NextResponse.json(
        { error: "إدارة الأحياء للمالكة والمديرة فقط" },
        { status: 403 },
      ),
    };
  }
  return { session };
}

function failure(error: unknown, fallback: string) {
  if (error instanceof DistrictError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : fallback },
    { status: 500 },
  );
}

/**
 * A new fare applies to orders that choose the district from now on. Trips
 * already priced keep the fare they were given.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, response } = await adminSession();
  if (!session) return response;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "الحي غير موجود" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  try {
    const patch: { name?: string; tripPrice?: number; isActive?: boolean } = {};
    if (body?.name !== undefined) patch.name = parseDistrictName(body.name);
    if (body?.tripPrice !== undefined) patch.tripPrice = parseTripPrice(body.tripPrice);
    if (typeof body?.isActive === "boolean") patch.isActive = body.isActive;
    if (!Object.keys(patch).length) {
      return NextResponse.json({ error: "لا يوجد تعديل" }, { status: 400 });
    }
    const district = await updateDistrict(session.userId, id, patch);
    return NextResponse.json({ ok: true, district });
  } catch (error) {
    return failure(error, "تعذّر حفظ الحي");
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, response } = await adminSession();
  if (!session) return response;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "الحي غير موجود" }, { status: 404 });

  try {
    const result = await deleteDistrict(session.userId, id);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return failure(error, "تعذّر حذف الحي");
  }
}
