import { listFieldOrders } from "@/lib/field-staff";
import {
  authorizeFieldStaffRequest,
  mobileData,
  mobileServerError,
} from "@/lib/mobile/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeFieldStaffRequest(request);
  if (auth.response) return auth.response;
  try {
    return mobileData({ orders: await listFieldOrders(auth.session) });
  } catch (error) {
    return mobileServerError(error, "FIELD_ORDERS_FAILED", "Unable to load assigned orders");
  }
}
