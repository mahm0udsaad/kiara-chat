import { getConversationAuditReport } from "@/lib/audit-report";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";

export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/v1/conversations/:id/audit — the responsibility trail.
 *
 * Owner-only, and deliberately so: this answers "whose shift was this on", and
 * an employee browsing her colleagues' record is a different product. It reads
 * across every thread regardless of inbox routing, which is exactly why it
 * cannot be exposed to an agent.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;
  if (auth.session.role !== "admin") {
    return mobileError(403, "ADMIN_REQUIRED", "صلاحية الإدارة مطلوبة");
  }

  const { id } = await params;
  try {
    const report = await getConversationAuditReport(id);
    if (!report) {
      return mobileError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");
    }
    return mobileData(report);
  } catch (error) {
    return mobileServerError(
      error,
      "CONVERSATION_AUDIT_FAILED",
      "تعذّر تحميل سجل المسؤولية",
    );
  }
}
