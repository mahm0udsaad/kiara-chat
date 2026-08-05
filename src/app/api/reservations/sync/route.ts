import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { fetchRekazReservations } from "@/lib/rekaz";
import {
  fillMissingCustomerNames,
  publishReservationsSnapshot,
} from "@/lib/reservations";

/**
 * POST /api/reservations/sync — pull the schedule from Rekaz.
 *
 * What the تحديث من ركاز button on /orders calls. Reads the platform's own
 * endpoint (no API key exists yet — see `src/lib/rekaz.ts`), republishes the
 * snapshot /orders renders, and names any WhatsApp thread the booking can name.
 *
 * The snapshot is written before the name fill so a failure while naming still
 * leaves the schedule refreshed.
 */

/** Two pages of Rekaz plus a bucket write; comfortably inside this. */
export const maxDuration = 60;

export async function POST() {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let reservations;
  try {
    reservations = await fetchRekazReservations();
  } catch (e) {
    console.error("[reservations/sync] Rekaz fetch failed", e);
    return NextResponse.json(
      { error: "تعذّر الاتصال بمنصة ركاز — حاولي بعد قليل" },
      { status: 502 }
    );
  }

  const syncedAt = new Date().toISOString();
  try {
    await publishReservationsSnapshot({ syncedAt, reservations });
  } catch (e) {
    console.error("[reservations/sync] publish failed", e);
    return NextResponse.json({ error: "تعذّر حفظ الحجوزات" }, { status: 500 });
  }

  // Best effort: the schedule is already live, and an unnamed thread is a
  // cosmetic problem next to a stale one.
  let namesFilled = 0;
  try {
    namesFilled = await fillMissingCustomerNames(reservations);
  } catch (e) {
    console.error("[reservations/sync] name fill failed", e);
  }

  return NextResponse.json({
    ok: true,
    syncedAt,
    reservations: reservations.length,
    days: new Set(reservations.map((r) => r.arrivalAt.slice(0, 10))).size,
    namesFilled,
  });
}
