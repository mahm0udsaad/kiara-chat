/**
 * POST /api/mobile/v1/catalog/sync — pull the service list from Rekaz.
 *
 * The bearer twin of /api/catalog/sync, for the button on the account screen.
 * Open to every office member for the same reason: it only mirrors Rekaz.
 */
import { syncCatalogFromRekaz } from "@/lib/rekaz-catalog";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
} from "@/lib/mobile/http";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  try {
    return mobileData(await syncCatalogFromRekaz());
  } catch (error) {
    console.error("[mobile-api] CATALOG_SYNC_FAILED", error);
    return mobileError(
      502,
      "CATALOG_SYNC_FAILED",
      "تعذّر جلب الخدمات من ركاز — حاولي بعد قليل",
    );
  }
}
