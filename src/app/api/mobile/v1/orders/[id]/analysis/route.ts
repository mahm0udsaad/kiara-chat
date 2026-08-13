import { analyzeCustomer } from "@/lib/customer-analysis";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";
import { getMobileOrderById } from "@/lib/mobile/orders";

export const maxDuration = 60;

/**
 * Analyze only the conversation attached to an order the employee can view.
 * This keeps the mobile endpoint from becoming an arbitrary phone lookup and
 * preserves the inbox's exclusive-routing authorization.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  const { id } = await params;
  try {
    const order = await getMobileOrderById(id, auth.session);
    if (!order) return mobileError(404, "ORDER_NOT_FOUND", "Order not found");

    const analysis = await analyzeCustomer(order.customer_phone, {
      conversationId: order.conversation_id,
    });
    if (!analysis) {
      return mobileError(
        422,
        "ANALYSIS_UNAVAILABLE",
        "التحليل غير متاح — لا توجد محادثة كافية أو لم تُفعّل خدمة الذكاء."
      );
    }

    return mobileData({ analysis });
  } catch (error) {
    return mobileServerError(
      error,
      "ORDER_ANALYSIS_FAILED",
      "تعذّر تحليل محادثة العميلة"
    );
  }
}
