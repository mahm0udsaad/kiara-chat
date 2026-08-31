import { getOrderAuditLog } from "@/lib/audit-report";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/orders/:id/audit — every action taken on one order. */
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
    const log = await getOrderAuditLog(id);
    if (!log) return mobileError(404, "ORDER_NOT_FOUND", "Order not found");
    return mobileData(log);
  } catch (error) {
    return mobileServerError(error, "ORDER_AUDIT_FAILED", "تعذّر تحميل سجل الطلب");
  }
}
