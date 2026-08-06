import { requireKiaraSession } from "@/lib/tenant";
import { listDriverOrders } from "@/lib/dispatch";
import {
  getReservationsSnapshot,
  withFixedTestReservation,
} from "@/lib/reservations";
import { stripPrices } from "@/lib/orders-visibility";
import { listReservationFollowUps } from "@/lib/reservation-follow-up-server";
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
  const todayKey = TODAY_KEY_FMT.format(new Date());
  const [orders, rawSnapshot] = await Promise.all([
    listDriverOrders(),
    // Best-effort: a missing snapshot only hides the Rekaz tab's content.
    getReservationsSnapshot().catch(() => null),
  ]);
  const snapshot = withFixedTestReservation(rawSnapshot, todayKey);
  const reservationFollowUps = await listReservationFollowUps(
    snapshot.reservations
  ).catch(() => ({}));

  return (
    <OrdersClient
      initialOrders={isAdmin ? orders : stripPrices(orders)}
      isAdmin={isAdmin}
      todayKey={todayKey}
      reservationsSnapshot={snapshot}
      initialReservationFollowUps={reservationFollowUps}
    />
  );
}
