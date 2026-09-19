import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { createExtraTeamOrder } from "@/lib/dispatch";

/** Raise a pending order for a second specialist and driver on the same visit. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    const order = await createExtraTeamOrder(id, {
      userId: session.userId,
      teamMemberId: session.teamMemberId,
      role: session.role,
    });
    return NextResponse.json({ ok: true, order }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "تعذّر إنشاء طلب الفريق الإضافي" },
      { status: 500 }
    );
  }
}
