import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";
import { listMobileOrdersInRange } from "@/lib/mobile/orders";
import { getReservationsSnapshot, type RekazReservation } from "@/lib/reservations";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 31;

function startOfDay(day: string): string {
  return `${day}T00:00:00+03:00`;
}

function endOfDay(day: string): string {
  return `${day}T23:59:59+03:00`;
}

export async function GET(request: Request) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!DAY_KEY.test(from) || !DAY_KEY.test(to)) {
    return mobileError(400, "INVALID_DATE_RANGE", "from and to must be YYYY-MM-DD");
  }
  const fromTime = new Date(startOfDay(from)).getTime();
  const toTime = new Date(endOfDay(to)).getTime();
  if (
    !Number.isFinite(fromTime) ||
    !Number.isFinite(toTime) ||
    toTime < fromTime ||
    toTime - fromTime > MAX_RANGE_DAYS * 24 * 60 * 60 * 1_000
  ) {
    return mobileError(400, "INVALID_DATE_RANGE", "The calendar range is invalid or too large");
  }

  try {
    const admin = getAdminSupabaseClient();
    // Reservations, orders and the sync banner are three independent reads.
    // Issued together they cost one round trip instead of three, which on the
    // calendar — the screen the day is run from — is most of its load time.
    const normalizedPromise = admin
      .from("rekaz_reservations")
      .select("payload")
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .is("removed_at", null)
      // The delta sync retains cancellations so a cancelled booking can be
      // told apart from one deleted out of Rekaz. The operational calendar is
      // a display surface and shows only live visits.
      .neq("status", "Cancelled")
      .gte("arrival_at", startOfDay(from))
      .lte("arrival_at", endOfDay(to))
      .order("arrival_at", { ascending: true });

    const ordersPromise = listMobileOrdersInRange({
      session: auth.session,
      from: startOfDay(from),
      to: endOfDay(to),
    });
    const lastRunPromise = admin
      .from("rekaz_sync_runs")
      .select("id, completed_at, incoming_count, added_count, updated_count, removed_count")
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const normalized = await normalizedPromise;
    let reservations: RekazReservation[];
    if (!normalized.error) {
      reservations = (normalized.data ?? [])
        .map((row) => row.payload as RekazReservation)
        .filter(Boolean);
    } else {
      // Transitional compatibility until the normalized migration is applied.
      const snapshot = await getReservationsSnapshot();
      reservations = (snapshot?.reservations ?? []).filter((reservation) => {
        const at = new Date(reservation.arrivalAt).getTime();
        return at >= fromTime && at <= toTime;
      });
    }

    const [orders, { data: lastRun }] = await Promise.all([
      ordersPromise,
      lastRunPromise,
    ]);

    return mobileData({
      from,
      to,
      reservations,
      orders,
      sync: lastRun
        ? {
            id: lastRun.id,
            completedAt: lastRun.completed_at,
            incoming: lastRun.incoming_count,
            added: lastRun.added_count,
            updated: lastRun.updated_count,
            removed: lastRun.removed_count,
          }
        : null,
    });
  } catch (error) {
    return mobileServerError(
      error,
      "ORDER_CALENDAR_FAILED",
      "تعذّر تحميل تقويم العمليات",
    );
  }
}
