import { publishReservationsSnapshot } from "@/lib/reservations";
import { fetchRekazReservations, isCancelledReservation } from "@/lib/rekaz";
import { applyRekazSync } from "@/lib/rekaz-sync";
import { drainServiceNotifications } from "@/lib/order-service-changes";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("x-cron-secret") !== secret)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  // Delivery retries still run if Rekaz is unavailable.
  const results = await Promise.allSettled([
    drainServiceNotifications(),
    fetchRekazReservations().then(async ({ reservations, window }) => {
      await applyRekazSync({ reservations, window, session: null });
      await publishReservationsSnapshot({
        syncedAt: new Date().toISOString(),
        reservations: reservations.filter((r) => !isCancelledReservation(r)),
      });
    }),
  ]);
  const failed = results.some((result) => result.status === "rejected");
  return Response.json(
    { ok: !failed, notifications: results[0].status, rekaz: results[1].status },
    { status: failed ? 502 : 200 },
  );
}
