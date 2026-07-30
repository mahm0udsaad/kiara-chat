import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { listDriverOrders } from "@/lib/dispatch";
import { stripPrices } from "@/lib/orders-visibility";

/** The orders list, refetched by the page's refresh button. */
export async function GET() {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const orders = await listDriverOrders();
    return NextResponse.json({
      orders: session.role === "admin" ? orders : stripPrices(orders),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "تعذّر تحميل الطلبات" },
      { status: 500 }
    );
  }
}
