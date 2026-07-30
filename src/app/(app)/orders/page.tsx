import { requireKiaraSession } from "@/lib/tenant";
import { listDriverOrders } from "@/lib/dispatch";
import { stripPrices } from "@/lib/orders-visibility";
import { OrdersClient } from "@/components/orders-client";

export const dynamic = "force-dynamic";

/** Today in Riyadh wall-clock — the operation's timezone, not the server's. */
const TODAY_KEY_FMT = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Asia/Riyadh",
});

export default async function OrdersPage() {
  const session = await requireKiaraSession();
  const isAdmin = session.role === "admin";
  const orders = await listDriverOrders();

  return (
    <OrdersClient
      initialOrders={isAdmin ? orders : stripPrices(orders)}
      isAdmin={isAdmin}
      todayKey={TODAY_KEY_FMT.format(new Date())}
    />
  );
}
