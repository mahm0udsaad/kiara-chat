import { NextResponse } from "next/server";

import { orderExists, previewBookingDispatch } from "@/lib/dispatch";
import { getKiaraSession } from "@/lib/tenant";
import type { TripType } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/** `{ serviceId: specialistId }`, ignoring anything that is not a pair of strings. */
function readServiceAssignments(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [serviceId, specialistId] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof specialistId === "string" && specialistId) out[serviceId] = specialistId;
  }
  return out;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getKiaraSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "البيانات غير صحيحة" }, { status: 400 });
  }
  const specialistId = String(body.specialistId ?? "").trim();
  const secondSpecialistId = String(body.secondSpecialistId ?? "").trim() || undefined;
  const driverId = String(body.driverId ?? "").trim();
  const specialistNote = String(body.specialistNote ?? "").trim().slice(0, 500);
  // The preview must quote the address that is about to be committed, not the
  // one stored before the employee corrected it.
  const customerLocation = String(body.customerLocation ?? "").trim().slice(0, 500);
  const driverMessage = String(body.driverMessage ?? "").trim().slice(0, 3_000);
  const tripType: TripType | undefined =
    body.tripType === "one_way" || body.tripType === "round_trip"
      ? body.tripType
      : undefined;
  if (!specialistId || !driverId || !driverMessage) {
    return NextResponse.json(
      { error: "اختاري الأخصائية والسائق وراجعي رسالة السائق" },
      { status: 400 },
    );
  }
  if (secondSpecialistId === specialistId) {
    return NextResponse.json({ error: "اختاري أخصائيتين مختلفتين" }, { status: 400 });
  }

  const { id } = await params;
  try {
    // Any employee may act on any order: the schedule is shared work, and the
    // inbox's exclusive routing governs reading a chat, not dispatching a car.
    if (!(await orderExists(id))) {
      return NextResponse.json({ error: "الطلب غير موجود" }, { status: 404 });
    }

    const preview = await previewBookingDispatch(id, {
      specialistId,
      secondSpecialistId,
      serviceAssignments: readServiceAssignments(body.serviceAssignments),
      driverId,
      customerLocation,
      specialistNote,
      driverMessage,
      tripType,
    });
    return NextResponse.json({ ok: true, preview });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "تعذّر تجهيز الرسائل" },
      { status: 500 },
    );
  }
}
