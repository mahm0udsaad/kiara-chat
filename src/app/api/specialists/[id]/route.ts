import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { updateSpecialist, type RosterPatch } from "@/lib/dispatch";
import { isNationalityCode } from "@/lib/nationalities";
import { isSpecialistLanguageCode } from "@/lib/specialist-languages";
import { pointFromMapText } from "@/lib/punctuality";

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
  if (typeof body?.preferredLanguage === "string")
    patch.preferredLanguage = isSpecialistLanguageCode(body.preferredLanguage)
      ? body.preferredLanguage
      : null;
  else if (body?.preferredLanguage === null) patch.preferredLanguage = null;
  // One field: a Google Maps link (short links included) or "lat, lng".
  if (typeof body?.pickupLocation === "string" || body?.pickupLocation === null) {
    const text = body.pickupLocation?.trim() ?? "";
    if (!text) {
      patch.pickupLatitude = null;
      patch.pickupLongitude = null;
    } else {
      const point = await pointFromMapText(text);
      if (!point) {
        return NextResponse.json(
          { error: "تعذّر قراءة الموقع. الصقي رابط خرائط Google أو الإحداثيات مثل 17.52, 44.20" },
          { status: 400 },
        );
      }
      patch.pickupLatitude = point.lat;
      patch.pickupLongitude = point.lng;
    }
  }
  if (typeof body?.pickupLocationLabel === "string" || body?.pickupLocationLabel === null) {
    const label = body?.pickupLocationLabel?.trim() || null;
    if (label && (label.length < 3 || label.length > 500)) {
      return NextResponse.json({ error: "وصف موقع الأخصائية يجب أن يكون بين 3 و500 حرف" }, { status: 400 });
    }
    patch.pickupLocationLabel = label;
  }
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
