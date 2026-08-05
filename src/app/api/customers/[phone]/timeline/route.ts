import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { getCustomerTimeline } from "@/lib/customer-timeline";

/**
 * GET /api/customers/:phone/timeline — one customer, everything in one place.
 *
 * The reservations table opens this in a drawer. `:phone` is E.164 (`+9665…`,
 * URL-encoded); the timeline module matches it on the national part so any
 * stored variant resolves. Reads only — no writes.
 */
export const maxDuration = 30;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ phone: string }> }
) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { phone: raw } = await params;
  const phone = decodeURIComponent(raw ?? "");
  if (phone.replace(/\D/g, "").length < 8) {
    return NextResponse.json({ error: "رقم غير صحيح" }, { status: 400 });
  }

  try {
    const timeline = await getCustomerTimeline(phone);
    return NextResponse.json(timeline);
  } catch (e) {
    console.error("[customers/timeline] failed", e);
    return NextResponse.json({ error: "تعذّر تحميل سجل العميلة" }, { status: 500 });
  }
}
