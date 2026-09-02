import { NextResponse } from "next/server";
import {
  dispatchBooking,
  orderExists,
  type DispatchBookingInput,
} from "@/lib/dispatch";
import { isLocationUnset } from "@/lib/format";
import { getKiaraSession } from "@/lib/tenant";
import { OperationalCommandError } from "@/lib/operational-commands";

export const runtime = "nodejs";
export const maxDuration = 60;

/** A recording longer than this is a phone call, not a note. */
const MAX_VOICE_BYTES = 8 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Assign the booking and publish both notes to the field team's app. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getKiaraSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // A written note comes as JSON; a recorded one needs multipart so the audio
  // streams up instead of being inflated to base64 in the browser.
  let specialistId: string | undefined;
  let driverId: string | undefined;
  let customerLocation: string | undefined;
  let specialistNote: string | undefined;
  let driverMessage: string | undefined;
  let specialistMessage: string | undefined;
  let expectedVersion: number | undefined;
  let idempotencyKey: string | undefined;
  let tripType: DispatchBookingInput["tripType"];
  let specialistVoice: DispatchBookingInput["specialistVoice"];

  if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
    }
    specialistId = (form.get("specialistId") as string | null)?.trim();
    driverId = (form.get("driverId") as string | null)?.trim();
    customerLocation = (form.get("customerLocation") as string | null)?.trim().slice(0, 500);
    specialistNote = (form.get("specialistNote") as string | null)?.trim().slice(0, 500);
    driverMessage = (form.get("driverMessage") as string | null)?.trim().slice(0, 3000);
    specialistMessage = (form.get("specialistMessage") as string | null)?.trim().slice(0, 3000);
    expectedVersion = Number(form.get("expectedVersion"));
    idempotencyKey = (form.get("idempotencyKey") as string | null)?.trim();
    const formTripType = form.get("tripType");
    tripType =
      formTripType === "round_trip" || formTripType === "one_way"
        ? formTripType
        : undefined;
    const voice = form.get("specialistVoice");
    if (voice instanceof File && voice.size > 0) {
      if (voice.size > MAX_VOICE_BYTES) {
        return NextResponse.json(
          { error: "الملاحظة الصوتية أطول من اللازم" },
          { status: 413 }
        );
      }
      specialistVoice = {
        base64: Buffer.from(await voice.arrayBuffer()).toString("base64"),
        contentType: voice.type || "audio/ogg",
        filename: voice.name || "note.ogg",
      };
    }
  } else {
    const body = await request.json().catch(() => ({}));
    specialistId = (body?.specialistId as string | undefined)?.trim();
    driverId = (body?.driverId as string | undefined)?.trim();
    customerLocation = (body?.customerLocation as string | undefined)?.trim().slice(0, 500);
    specialistNote = (body?.specialistNote as string | undefined)?.trim().slice(0, 500);
    driverMessage = (body?.driverMessage as string | undefined)?.trim().slice(0, 3000);
    specialistMessage = (body?.specialistMessage as string | undefined)?.trim().slice(0, 3000);
    expectedVersion = Number(body?.expectedVersion);
    idempotencyKey = (body?.idempotencyKey as string | undefined)?.trim();
    tripType =
      body?.tripType === "round_trip" || body?.tripType === "one_way"
        ? body.tripType
        : undefined;
  }

  if (isLocationUnset(customerLocation)) {
    return NextResponse.json(
      { error: "حدّدي موقع العميلة قبل اختيار الأخصائية والسائق" },
      { status: 400 },
    );
  }
  if (!specialistId) {
    return NextResponse.json({ error: "اختاري الأخصائية" }, { status: 400 });
  }
  if (!driverId) {
    return NextResponse.json({ error: "اختاري السائق" }, { status: 400 });
  }
  if (!driverMessage) {
    return NextResponse.json({ error: "ملاحظة السائق مطلوبة" }, { status: 400 });
  }
  if (!specialistMessage) {
    return NextResponse.json({ error: "ملاحظة الأخصائية النهائية مطلوبة" }, { status: 400 });
  }
  if (!Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 1) {
    return NextResponse.json({ error: "حدّثي الطلب ثم أعيدي المحاولة" }, { status: 400 });
  }
  if (!idempotencyKey || !UUID.test(idempotencyKey)) {
    return NextResponse.json({ error: "معرّف العملية غير صحيح" }, { status: 400 });
  }

  try {
    // Any employee may act on any order: the schedule is shared work, and the
    // inbox's exclusive routing governs reading a chat, not dispatching a car.
    if (!(await orderExists(id))) {
      return NextResponse.json({ error: "الطلب غير موجود" }, { status: 404 });
    }

    const result = await dispatchBooking(id, {
      specialistId,
      driverId,
      customerLocation: customerLocation as string,
      specialistNote: specialistNote || undefined,
      specialistVoice,
      driverMessage,
      specialistMessage,
      expectedVersion: Number(expectedVersion),
      idempotencyKey,
      actor: {
        userId: session.userId,
        teamMemberId: session.teamMemberId,
        role: session.role,
      },
      tripType,
    });
    return NextResponse.json({
      ok: true,
      ...result,
      order:
        session.role === "admin"
          ? result.order
          : { ...result.order, price: null },
    });
  } catch (error) {
    if (error instanceof OperationalCommandError && error.isConflict) {
      return NextResponse.json(
        {
          error: "عدّلت موظفة أخرى الطلب أو بدأت إسناده. حدّثي الطلب قبل المتابعة.",
          code: error.code,
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "تعذّر إسناد الطلب",
      },
      { status: 500 }
    );
  }
}
