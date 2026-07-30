import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { resendDriverOrder } from "@/lib/dispatch";

/** Re-push a saved order to its driver's WhatsApp (recovery for a failed send). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    const { order, sent } = await resendDriverOrder(id);
    // Price is owner/manager-only — don't leak it to an agent via the response.
    const safeOrder = session.role === "admin" ? order : { ...order, price: null };
    return NextResponse.json({ ok: true, order: safeOrder, sent });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "تعذّرت إعادة الإرسال" },
      { status: 500 }
    );
  }
}
