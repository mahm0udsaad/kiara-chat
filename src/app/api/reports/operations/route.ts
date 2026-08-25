import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import {
  getOperationsReport,
  OperationsReportInputError,
} from "@/lib/operations-report";

export async function GET(request: Request) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const params = new URL(request.url).searchParams;
  try {
    const report = await getOperationsReport({
      from: params.get("from") ?? "",
      to: params.get("to") ?? "",
      startTime: params.get("startTime") ?? undefined,
      endTime: params.get("endTime") ?? undefined,
    });
    return NextResponse.json(report, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    if (error instanceof OperationsReportInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[operations-report]", error);
    return NextResponse.json({ error: "تعذّر تحميل تقرير العمليات" }, { status: 500 });
  }
}
