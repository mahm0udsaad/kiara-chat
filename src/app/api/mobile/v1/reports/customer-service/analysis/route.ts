import { analyzeCustomerServiceAgent } from "@/lib/customer-service-analysis";
import { OperationsReportInputError } from "@/lib/operations-report";
import { authorizeMobileRequest, mobileData, mobileError, mobileServerError } from "@/lib/mobile/http";

export const maxDuration = 60;

export async function POST(request: Request) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;
  if (!auth.session.isOwner) {
    return mobileError(403, "OWNER_REQUIRED", "هذا التحليل متاح للمالكة فقط");
  }
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  try {
    const analysis = await analyzeCustomerServiceAgent(String(body.personId ?? ""), {
      from: String(body.from ?? ""),
      to: String(body.to ?? ""),
      startTime: String(body.startTime ?? "00:00"),
      endTime: String(body.endTime ?? "23:59"),
    });
    if (!analysis) {
      return mobileError(422, "ANALYSIS_UNAVAILABLE", "لا توجد محادثات كافية للتحليل خلال الفترة المختارة أو خدمة الذكاء غير مفعّلة");
    }
    return mobileData({ analysis });
  } catch (error) {
    if (error instanceof OperationsReportInputError) {
      return mobileError(400, "INVALID_REPORT_RANGE", error.message);
    }
    return mobileServerError(error, "AGENT_ANALYSIS_FAILED", "تعذّر تحليل أداء الموظفة");
  }
}
