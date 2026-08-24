import { getDriverOrderById, listDriverOrders } from "@/lib/dispatch";
import {
  type MobileOrder,
  type MobilePage,
} from "@/lib/mobile/contracts";
import { stripPrices } from "@/lib/orders-visibility";
import { phoneMatches } from "@/lib/phone";
import { type KiaraSession } from "@/lib/tenant";

const MAX_MOBILE_ORDER_SCAN = 200;

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
  const order = await getDriverOrderById(orderId);
  return order ? orderForMobileSession(order, session) : null;
}

/**
 * Every order arriving inside a window, enriched once.
 *
 * The calendar asks by date, so it reads by date. It used to page through
 * `listMobileOrders` twice — repeating the whole enrichment on the second
 * pass — and then discard, in JavaScript, every order outside the week it
 * had asked for.
 */
export async function listMobileOrdersInRange(options: {
  session: KiaraSession;
  from: string;
  to: string;
}): Promise<MobileOrder[]> {
  const orders = await listDriverOrders({
    from: options.from,
    to: options.to,
    limit: MAX_MOBILE_ORDER_SCAN,
  });
  return options.session.role === "admin" ? orders : stripPrices(orders);
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
