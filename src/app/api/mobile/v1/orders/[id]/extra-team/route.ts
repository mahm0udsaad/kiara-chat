import { createExtraTeamOrder, orderExists } from "@/lib/dispatch";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";
import { orderForMobileSession } from "@/lib/mobile/orders";

/**
 * A second specialist with her own driver for a visit already under way. The
 * new order is pending; the phone opens its dispatch screen next, so it goes
 * out through the same preview as any other order.
 */
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  const { id } = await params;
  try {
    if (!(await orderExists(id))) {
      return mobileError(404, "ORDER_NOT_FOUND", "Order not found");
    }
    const order = await createExtraTeamOrder(id, {
      userId: auth.session.userId,
      teamMemberId: auth.session.teamMemberId,
      role: auth.session.role,
    });
    return mobileData({ order: orderForMobileSession(order, auth.session) }, 201);
  } catch (error) {
    return mobileServerError(
      error,
      "EXTRA_TEAM_ORDER_FAILED",
      "تعذّر إنشاء طلب الفريق الإضافي",
    );
  }
}
