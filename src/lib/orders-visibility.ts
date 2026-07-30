import type { DriverOrderRow } from "@/lib/types";

/**
 * Prices are owner/manager-only (RLS hides dispatch_settings from agents, and
 * the snapshot on the order must not leak them back). Every path that returns
 * orders to a non-admin runs them through here.
 */
export function stripPrices(orders: DriverOrderRow[]): DriverOrderRow[] {
  return orders.map((o) => ({ ...o, price: null }));
}
