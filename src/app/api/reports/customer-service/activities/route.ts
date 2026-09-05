import { NextResponse } from "next/server";

import { getCustomerServiceEmployeeActivities } from "@/lib/customer-service-report";
import { OperationsReportInputError } from "@/lib/operations-report";
import { getKiaraSession } from "@/lib/tenant";

export async function GET(request: Request) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.isOwner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const params = new URL(request.url).searchParams;
  try {
    const limit = Number(params.get("limit")) || undefined;
    const offset = Number(params.get("offset")) || undefined;
    return NextResponse.json(
      await getCustomerServiceEmployeeActivities({
        personId: params.get("personId") ?? "",
        from: params.get("from") ?? "",
        to: params.get("to") ?? "",
        startTime: params.get("startTime") ?? undefined,
        endTime: params.get("endTime") ?? undefined,
        limit,
        offset,
      }),
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    if (error instanceof OperationsReportInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[customer-service-activities]", error);
    return NextResponse.json({ error: "تعذّر تحميل أنشطة الموظفة" }, { status: 500 });
  }
}
