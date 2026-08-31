import { NextResponse } from "next/server";

import { getConversationAuditReport } from "@/lib/audit-report";
import { getKiaraSession } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/**
 * GET /api/conversations/:id/audit — who held this thread and what they did.
 *
 * Owner-only: it reads across every conversation regardless of inbox routing,
 * and "how did my colleague handle her chats" is not a question an agent gets
 * to ask of this app.
 */
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
    const report = await getConversationAuditReport(id);
    if (!report) {
      return NextResponse.json({ error: "المحادثة غير موجودة" }, { status: 404 });
    }
    return NextResponse.json(report);
  } catch (error) {
    console.error("[audit] conversation report failed", error);
    return NextResponse.json(
      { error: "تعذّر تحميل سجل المسؤولية" },
      { status: 500 },
    );
  }
}
