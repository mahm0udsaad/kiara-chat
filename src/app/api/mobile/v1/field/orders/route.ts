import {
  listFieldOrders,
  type FieldOrderListView,
} from "@/lib/field-staff";
import {
  authorizeFieldStaffRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";

export const dynamic = "force-dynamic";

const VIEWS = new Set<FieldOrderListView>([
  "today",
  "upcoming",
  "previous",
  "done",
]);

export async function GET(request: Request) {
  const auth = await authorizeFieldStaffRequest(request);
  if (auth.response) return auth.response;
  const params = new URL(request.url).searchParams;
  const rawView = params.get("view");
  const view = rawView && VIEWS.has(rawView as FieldOrderListView)
    ? (rawView as FieldOrderListView)
    : undefined;
  if (rawView && !view) {
    return mobileError(400, "INVALID_FIELD_ORDER_VIEW", "Unsupported field order view");
  }
  const dayStart = params.get("dayStart") ?? undefined;
  const dayEnd = params.get("dayEnd") ?? undefined;
  if (
    view &&
    view !== "done" &&
    (!dayStart || !dayEnd || !Number.isFinite(Date.parse(dayStart)) || !Number.isFinite(Date.parse(dayEnd)))
  ) {
    return mobileError(400, "INVALID_DAY_BOUNDS", "Valid dayStart and dayEnd are required");
  }
  try {
    return mobileData({
      orders: await listFieldOrders(auth.session, { view, dayStart, dayEnd }),
    });
  } catch (error) {
    return mobileServerError(error, "FIELD_ORDERS_FAILED", "Unable to load assigned orders");
  }
}
