import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { syncCatalogFromRekaz } from "@/lib/rekaz-catalog";

/**
 * POST /api/catalog/sync — pull the service list from Rekaz.
 *
 * What the تحديث الخدمات من ركاز button calls. Open to every member, like the
 * reservations pull: it only ever mirrors Rekaz — adds and updates, never
 * hides — so pressing it cannot lose anything, and the employee who notices a
 * missing service is usually the one replying to the customer who asked.
 */
export const maxDuration = 60;

export async function POST() {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    return NextResponse.json({ ok: true, ...(await syncCatalogFromRekaz()) });
  } catch (error) {
    console.error("[catalog/sync] Rekaz pull failed", error);
    return NextResponse.json(
      { error: "تعذّر جلب الخدمات من ركاز — حاولي بعد قليل" },
      { status: 502 },
    );
  }
}
