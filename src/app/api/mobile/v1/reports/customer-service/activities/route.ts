import { getCustomerServiceEmployeeActivities } from "@/lib/customer-service-report";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
  parseIntegerParam,
} from "@/lib/mobile/http";
import { OperationsReportInputError } from "@/lib/operations-report";

export async function GET(request: Request) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;
  if (!auth.session.isOwner) {
    return mobileError(403, "OWNER_REQUIRED", "هذا التقرير متاح للمالكة فقط");
  }
  const params = new URL(request.url).searchParams;
  try {
    const limit = parseIntegerParam(params.get("limit"), 20, 1, 100);
    const offset = parseIntegerParam(params.get("offset"), 0, 0, 100000);
    return mobileData(
      await getCustomerServiceEmployeeActivities({
        personId: params.get("personId") ?? "",
        from: params.get("from") ?? "",
        to: params.get("to") ?? "",
        startTime: params.get("startTime") ?? undefined,
        endTime: params.get("endTime") ?? undefined,
        limit,
        offset,
      }),
    );
  } catch (error) {
    if (error instanceof OperationsReportInputError) {
      return mobileError(400, "INVALID_REPORT_RANGE", error.message);
    }
    return mobileServerError(
      error,
      "CUSTOMER_SERVICE_ACTIVITIES_FAILED",
      "تعذّر تحميل أنشطة الموظفة",
    );
  }
}
