import { NextResponse } from "next/server";

import { getCustomerServiceReport } from "@/lib/customer-service-report";
import { OperationsReportInputError } from "@/lib/operations-report";
import { getKiaraSession } from "@/lib/tenant";

export async function GET(request: Request) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.isOwner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const params = new URL(request.url).searchParams;
  try {
    return NextResponse.json(
      await getCustomerServiceReport({
        from: params.get("from") ?? "",
        to: params.get("to") ?? "",
        startTime: params.get("startTime") ?? undefined,
        endTime: params.get("endTime") ?? undefined,
      }),
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    if (error instanceof OperationsReportInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[customer-service-report]", error);
    return NextResponse.json({ error: "تعذّر تحميل تقرير خدمة العملاء" }, { status: 500 });
  }
}
