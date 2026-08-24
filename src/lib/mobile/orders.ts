import { listDriverOrders } from "@/lib/dispatch";
import {
  type MobileOrder,
  type MobilePage,
} from "@/lib/mobile/contracts";
import { stripPrices } from "@/lib/orders-visibility";
import { phoneMatches } from "@/lib/phone";
import { type KiaraSession } from "@/lib/tenant";

const MAX_MOBILE_ORDER_SCAN = 200;
const MAX_MOBILE_ORDER_DETAIL_SCAN = 1_000;

export function orderForMobileSession(
  order: MobileOrder,
  session: KiaraSession
): MobileOrder {
  return session.role === "admin" ? order : stripPrices([order])[0]!;
}

export async function getMobileOrderById(
  orderId: string,
  session: KiaraSession
): Promise<MobileOrder | null> {
  // listDriverOrders is the existing enrichment path for customer, roster,
  // editor and field-session names. The high bound is used only for a direct
  // id lookup; PostgREST still applies its configured server row cap.
  const orders = await listDriverOrders(MAX_MOBILE_ORDER_DETAIL_SCAN);
  const order = orders.find((candidate) => candidate.id === orderId);
  return order ? orderForMobileSession(order, session) : null;
}

function matchesOrderSearch(order: MobileOrder, rawQuery: string): boolean {
  const query = rawQuery.trim().toLocaleLowerCase("ar");
  if (!query) return true;
  return (
    (order.customer_name ?? "").toLocaleLowerCase("ar").includes(query) ||
    (order.specialist_name ?? "").toLocaleLowerCase("ar").includes(query) ||
    (order.driver_name ?? "").toLocaleLowerCase("ar").includes(query) ||
    order.customer_location.toLocaleLowerCase("ar").includes(query) ||
    order.customer_phone.includes(query) ||
    phoneMatches(order.customer_phone, query)
  );
}

export async function listMobileOrders(options: {
  session: KiaraSession;
  search: string;
  offset: number;
  limit: number;
}): Promise<MobilePage<MobileOrder>> {
  // Every employee sees the whole schedule, as she does on the web /orders
  // screen. Prices remain owner/manager-only — that is a role rule about money,
  // not about whose chat it is.
  let visible = await listDriverOrders(MAX_MOBILE_ORDER_SCAN);
  if (options.session.role !== "admin") visible = stripPrices(visible);

  const matching = visible.filter((order) =>
    matchesOrderSearch(order, options.search)
  );
  const items = matching.slice(
    options.offset,
    options.offset + options.limit
  );
  const nextOffset = options.offset + items.length;

  return {
    items,
    offset: options.offset,
    limit: options.limit,
    total: matching.length,
    hasMore: nextOffset < matching.length,
    nextOffset: nextOffset < matching.length ? nextOffset : null,
  };
}
