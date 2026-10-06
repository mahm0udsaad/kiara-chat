import type { DriverOrderRow } from "@/lib/types";

/**
 * Trip costs are the owner's alone. Managers and agents run the orders but
 * never see what a trip costs, so every path that returns orders (or district
 * fares in a picker) to anyone else goes through here.
 */
export function canSeeTripCost(session: { isOwner: boolean }): boolean {
  return session.isOwner === true;
}

/** Strips trip costs from orders for anyone but the owner. */
export function stripPrices(orders: DriverOrderRow[]): DriverOrderRow[] {
  return orders.map((o) => ({ ...o, price: null, return_price: null }));
}
