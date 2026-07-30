import { requireKiaraSession } from "@/lib/tenant";
import { listDriverOrders } from "@/lib/dispatch";
import { stripPrices } from "@/lib/orders-visibility";
import { OrdersClient } from "@/components/orders-client";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const session = await requireKiaraSession();
  const isAdmin = session.role === "admin";
  const orders = await listDriverOrders();

  return (
    <OrdersClient
      initialOrders={isAdmin ? orders : stripPrices(orders)}
      isAdmin={isAdmin}
    />
  );
}
