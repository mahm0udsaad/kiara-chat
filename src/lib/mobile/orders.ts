import { canViewConversation } from "@/lib/conversation-meta";
import {
  getOrderConversationId,
  listDriverOrders,
} from "@/lib/dispatch";
import { getConversationById } from "@/lib/inbox";
import {
  type MobileOrder,
  type MobilePage,
} from "@/lib/mobile/contracts";
import { stripPrices } from "@/lib/orders-visibility";
import { phoneMatches } from "@/lib/phone";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { KIARA_RESTAURANT_ID, type KiaraSession } from "@/lib/tenant";

const MAX_MOBILE_ORDER_SCAN = 200;
const MAX_MOBILE_ORDER_DETAIL_SCAN = 1_000;

/**
 * Resolve an order through its conversation and apply the inbox's exclusive
 * routing rule. Returning null for both missing and forbidden orders avoids
 * revealing routed conversation ids to another employee.
 */
export async function getVisibleOrderConversationId(
  orderId: string,
  session: KiaraSession
): Promise<string | null> {
  const conversationId = await getOrderConversationId(orderId);
  if (!conversationId) return null;
  const conversation = await getConversationById(conversationId, {
    isAdmin: session.role === "admin",
    teamMemberId: session.teamMemberId,
  });
  return conversation ? conversationId : null;
}

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
  const conversationId = await getVisibleOrderConversationId(orderId, session);
  if (!conversationId) return null;

  // listDriverOrders is the existing enrichment path for customer, roster,
  // editor and field-session names. The high bound is used only for a direct
  // id lookup; PostgREST still applies its configured server row cap.
  const orders = await listDriverOrders(MAX_MOBILE_ORDER_DETAIL_SCAN);
  const order = orders.find(
    (candidate) =>
      candidate.id === orderId &&
      candidate.conversation_id === conversationId
  );
  return order ? orderForMobileSession(order, session) : null;
}

async function visibleOrderConversationIds(
  orders: MobileOrder[],
  session: KiaraSession
): Promise<Set<string>> {
  if (session.role === "admin") {
    return new Set(orders.map((order) => order.conversation_id));
  }

  const ids = [...new Set(orders.map((order) => order.conversation_id))];
  if (!ids.length) return new Set();

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("conversations")
    .select("id, metadata")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .in("id", ids);
  if (error) throw new Error(error.message);

  return new Set(
    (data ?? [])
      .filter((conversation) =>
        canViewConversation(conversation, {
          isAdmin: false,
          teamMemberId: session.teamMemberId,
        })
      )
      .map((conversation) => conversation.id as string)
  );
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
  const orders = await listDriverOrders(MAX_MOBILE_ORDER_SCAN);
  const visibleConversationIds = await visibleOrderConversationIds(
    orders,
    options.session
  );
  let visible = orders.filter((order) =>
    visibleConversationIds.has(order.conversation_id)
  );
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
