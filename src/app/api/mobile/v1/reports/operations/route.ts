import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";
import {
  getOperationsReport,
  OperationsReportInputError,
} from "@/lib/operations-report";

export async function GET(request: Request) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;
  if (!auth.session.isOwner) {
    return mobileError(403, "OWNER_REQUIRED", "هذا التقرير متاح للمالكة فقط");
  }

  const params = new URL(request.url).searchParams;
  try {
    return mobileData(
      await getOperationsReport({
        from: params.get("from") ?? "",
        to: params.get("to") ?? "",
        startTime: params.get("startTime") ?? undefined,
        endTime: params.get("endTime") ?? undefined,
      }),
    );
  } catch (error) {
    if (error instanceof OperationsReportInputError) {
      return mobileError(400, "INVALID_REPORT_RANGE", error.message);
    }
    return mobileServerError(error, "OPERATIONS_REPORT_FAILED", "تعذّر تحميل تقرير العمليات");
  }
}
