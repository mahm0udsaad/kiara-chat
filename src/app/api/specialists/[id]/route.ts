import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { updateSpecialist, type RosterPatch } from "@/lib/dispatch";
import { isNationalityCode } from "@/lib/nationalities";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const patch: RosterPatch = {};
  if (typeof body?.fullName === "string") patch.fullName = body.fullName;
  if (typeof body?.phone === "string") patch.phone = body.phone;
  if (typeof body?.isActive === "boolean") patch.isActive = body.isActive;
  if (typeof body?.nationality === "string")
    patch.nationality = isNationalityCode(body.nationality) ? body.nationality : null;
  else if (body?.nationality === null) patch.nationality = null;
  if (patch.fullName !== undefined && !patch.fullName.trim())
    return NextResponse.json({ error: "الاسم مطلوب" }, { status: 400 });

  try {
    const specialist = await updateSpecialist(id, patch);
    return NextResponse.json({ ok: true, specialist });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to update specialist" },
      { status: 500 }
    );
  }
}
