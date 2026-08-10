import {
  authorizeMobileRequest,
  mobileData,
  mobileServerError,
  parseIntegerParam,
} from "@/lib/mobile/http";
import { listMobileOrders } from "@/lib/mobile/orders";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  const url = new URL(request.url);
  const search = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const offset = parseIntegerParam(url.searchParams.get("offset"), 0, 0, 200);
  const limit = parseIntegerParam(url.searchParams.get("limit"), 50, 1, 100);

  try {
    const orders = await listMobileOrders({
      session: auth.session,
      search,
      offset,
      limit,
    });
    return mobileData({ query: search, orders });
  } catch (error) {
    return mobileServerError(
      error,
      "ORDERS_FAILED",
      "Unable to load orders"
    );
  }
}
