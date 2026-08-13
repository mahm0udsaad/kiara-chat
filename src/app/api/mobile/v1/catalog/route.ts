/**
 * GET /api/mobile/v1/catalog — the spa's services and packages.
 *
 * The phone's composer offers the same picker the web one does, so this only
 * ever returns what is on sale; the settings manager (web) is the caller that
 * wants hidden rows too.
 */
import { listCatalog } from "@/lib/catalog";
import {
  authorizeMobileRequest,
  mobileData,
  mobileServerError,
} from "@/lib/mobile/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  try {
    return mobileData({ items: await listCatalog({ availableOnly: true }) });
  } catch (error) {
    return mobileServerError(error, "CATALOG_FAILED", "تعذّر تحميل الباقات");
  }
}
