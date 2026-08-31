import { NextResponse } from "next/server";

import { getOrderAuditLog } from "@/lib/audit-report";
import { getKiaraSession } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/** GET /api/orders/:id/audit — every action taken on one order. Owner-only. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "صلاحية الإدارة مطلوبة" }, { status: 403 });
  }

  const { id } = await params;
  try {
    const log = await getOrderAuditLog(id);
    if (!log) return NextResponse.json({ error: "الطلب غير موجود" }, { status: 404 });
    return NextResponse.json(log);
  } catch (error) {
    console.error("[audit] order log failed", error);
    return NextResponse.json({ error: "تعذّر تحميل سجل الطلب" }, { status: 500 });
  }
}
