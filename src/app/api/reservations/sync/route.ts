import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { fetchRekazReservations, isCancelledReservation } from "@/lib/rekaz";
import {
  fillMissingCustomerNames,
  publishReservationsSnapshot,
} from "@/lib/reservations";
import { applyRekazSync, previewRekazSync } from "@/lib/rekaz-sync";

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

export async function GET() {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { reservations, window } = await fetchRekazReservations();
    const preview = await previewRekazSync(reservations, window);
    return NextResponse.json({
      ok: true,
      checkedAt: new Date().toISOString(),
      preview,
    });
  } catch (error) {
    console.error("[reservations/sync] preview failed", error);
    return NextResponse.json(
      { error: "تعذّر فحص تحديثات ركاز — حاولي بعد قليل" },
      { status: 502 },
    );
  }
}

export async function POST() {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let fetched;
  try {
    fetched = await fetchRekazReservations();
  } catch (e) {
    console.error("[reservations/sync] Rekaz fetch failed", e);
    return NextResponse.json(
      { error: "تعذّر الاتصال بمنصة ركاز — حاولي بعد قليل" },
      { status: 502 }
    );
  }

  const { reservations, window } = fetched;
  const syncedAt = new Date().toISOString();
  let changes;
  try {
    changes = await applyRekazSync({ reservations, window, session });
  } catch (e) {
    console.error("[reservations/sync] database apply failed", e);
    return NextResponse.json(
      { error: "تعذّر تطبيق تغييرات ركاز بأمان" },
      { status: 500 },
    );
  }

  // The normalized rows keep cancellations so the delta can tell a cancelled
  // booking apart from one deleted out of Rekaz. The legacy snapshot is a
  // display read-model, and /orders groups a customer's services into one
  // visit, so a cancelled service there would inflate the visit's total and
  // its time span. Filter for the blob only.
  const liveReservations = reservations.filter(
    (reservation) => !isCancelledReservation(reservation),
  );
  try {
    await publishReservationsSnapshot({ syncedAt, reservations: liveReservations });
  } catch (e) {
    console.error("[reservations/sync] publish failed", e);
    return NextResponse.json({ error: "تعذّر حفظ الحجوزات" }, { status: 500 });
  }

  // Best effort: the schedule is already live, and an unnamed thread is a
  // cosmetic problem next to a stale one.
  let namesFilled = 0;
  try {
    namesFilled = await fillMissingCustomerNames(liveReservations);
  } catch (e) {
    console.error("[reservations/sync] name fill failed", e);
  }

  // Counts describe the schedule the page renders, so they stay on the live
  // set; `changes` carries the full delta, cancellations included.
  return NextResponse.json({
    ok: true,
    syncedAt,
    reservations: liveReservations.length,
    days: new Set(liveReservations.map((r) => r.arrivalAt.slice(0, 10))).size,
    namesFilled,
    changes,
  });
}
