import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { analyzeCustomer } from "@/lib/customer-analysis";

/**
 * POST /api/customers/:phone/analysis — an AI read of the customer's experience.
 *
 * The timeline drawer's «تحليل رضا العميلة» button calls this on demand (not on
 * open — the model costs a call). Session-gated, read-only: it reads the thread
 * and Rekaz history and returns a structured verdict, writing nothing.
 */
export const maxDuration = 60;

export async function POST(
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
    const analysis = await analyzeCustomer(phone);
    if (!analysis) {
      return NextResponse.json(
        { error: "التحليل غير متاح — لا توجد محادثة كافية أو لم تُفعّل خدمة الذكاء." },
        { status: 422 }
      );
    }
    return NextResponse.json(analysis);
  } catch (e) {
    console.error("[customers/analysis] failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "تعذّر التحليل" },
      { status: 500 }
    );
  }
}
