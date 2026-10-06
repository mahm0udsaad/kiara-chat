import { getOrderTracking } from "@/lib/driver-tracking";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";

export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/v1/orders/[id]/tracking — the driver-tracking section of the
 * order screen: permission state, the trail, the ETA and the audit flags.
 *
 * Kept off the order payload on purpose. The order screen must load exactly
 * as it did before this section existed; this one is fetched beside it and is
 * allowed to fail on its own.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  const { id } = await params;
  try {
    const tracking = await getOrderTracking(id);
    if (!tracking) return mobileError(404, "ORDER_NOT_FOUND", "Order not found");
    return mobileData({ tracking });
  } catch (error) {
    return mobileServerError(error, "TRACKING_FAILED", "Unable to load driver tracking");
  }
}
