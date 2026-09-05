import { authorizeMobileRequest, mobileData, mobileError, mobileServerError } from "@/lib/mobile/http";
import { OperationsReportInputError } from "@/lib/operations-report";
import { getOrdersReport } from "@/lib/orders-report";

export async function GET(request: Request) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;
  if (!auth.session.isOwner) {
    return mobileError(403, "OWNER_REQUIRED", "هذا التقرير متاح للمالكة فقط");
  }
  const params = new URL(request.url).searchParams;
  try {
    return mobileData(await getOrdersReport({
      from: params.get("from") ?? "",
      to: params.get("to") ?? "",
      startTime: "00:00",
      endTime: "23:59",
    }));
  } catch (error) {
    if (error instanceof OperationsReportInputError) {
      return mobileError(400, "INVALID_REPORT_RANGE", error.message);
    }
    return mobileServerError(error, "ORDERS_REPORT_FAILED", "تعذّر تحميل تقرير الطلبات");
  }
}
