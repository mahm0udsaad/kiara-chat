import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";
import { fetchRekazReservations, type RekazFetchResult } from "@/lib/rekaz";
import { RekazAuthError } from "@/lib/rekaz-auth";
import { applyRekazSync, previewRekazSync } from "@/lib/rekaz-sync";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";

/**
 * Bearer-authenticated Rekaz check and pull for the mobile calendar.
 *
 * The web endpoint at /api/reservations/sync does the same work behind a
 * cookie session; native clients only ever send an access token, so they get
 * their own route rather than a cookie fallback that would weaken the v1
 * contract.
 *
 *   GET  — what a pull would change. Reads Rekaz, writes nothing.
 *   POST — apply the delta under the tenant advisory lock.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Every phone that opens the calendar would otherwise hit Rekaz's undocumented
 * endpoint on mount. One shared short-lived result keeps the banner honest
 * without turning a team of employees into a traffic source.
 */
const CHECK_TTL_MS = 60_000;
let cachedCheck: { at: number; promise: Promise<RekazFetchResult> } | null = null;

function fetchRekazCached(force: boolean): Promise<RekazFetchResult> {
  const now = Date.now();
  if (!force && cachedCheck && now - cachedCheck.at < CHECK_TTL_MS) {
    return cachedCheck.promise;
  }
  const promise = fetchRekazReservations();
  cachedCheck = { at: now, promise };
  // A failed fetch must not be cached, or one Rekaz blip silences the banner
  // for the whole TTL.
  promise.catch(() => {
    if (cachedCheck?.promise === promise) cachedCheck = null;
  });
  return promise;
}

async function lastCompletedRun() {
  const { data } = await getAdminSupabaseClient()
    .from("rekaz_sync_runs")
    .select("id, completed_at, added_count, updated_count, removed_count")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data
    ? {
        id: data.id as string,
        completedAt: data.completed_at as string | null,
        added: Number(data.added_count ?? 0),
        updated: Number(data.updated_count ?? 0),
        removed: Number(data.removed_count ?? 0),
      }
    : null;
}

/**
 * A Rekaz outage and a Rekaz login problem look identical to a caller that
 * only sees "failed", but they are not the same event: one clears by itself,
 * the other needs someone to reconnect the account. They get separate codes so
 * the banner can stop telling an employee to "try again in a moment" when
 * trying again cannot possibly help.
 */
function rekazFailure(error: unknown, fallbackCode: string, fallbackMessage: string) {
  if (error instanceof RekazAuthError) {
    return mobileError(
      424,
      "REKAZ_AUTH_REQUIRED",
      error.reason === "not_configured"
        ? "لم يتم ربط حساب ركاز بعد — تحتاج الإدارة إلى إدخال بيانات الدخول"
        : error.reason === "unreachable"
          ? "تعذّر الوصول إلى منصة ركاز"
          : "انتهت صلاحية جلسة ركاز — تحتاج الإدارة إلى إعادة ربط الحساب",
    );
  }
  return mobileError(502, fallbackCode, fallbackMessage);
}

export async function GET(request: Request) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  const force = new URL(request.url).searchParams.get("refresh") === "1";
  try {
    const { reservations, window } = await fetchRekazCached(force);
    const preview = await previewRekazSync(reservations, window);
    return mobileData({
      checkedAt: new Date().toISOString(),
      window,
      preview,
      lastSync: await lastCompletedRun(),
    });
  } catch (error) {
    // A Rekaz outage is not a Kiara outage: report it as an integration
    // failure so the banner can say so instead of showing a silent zero.
    console.error("[mobile-api] REKAZ_CHECK_FAILED", error);
    return rekazFailure(
      error,
      "REKAZ_CHECK_FAILED",
      "تعذّر فحص تحديثات ركاز — حاولي بعد قليل",
    );
  }
}

export async function POST(request: Request) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  let fetched: RekazFetchResult;
  try {
    // A pull always re-reads Rekaz. Applying a cached snapshot would let one
    // employee's stale preview overwrite changes made since it was taken.
    fetched = await fetchRekazReservations();
    cachedCheck = { at: Date.now(), promise: Promise.resolve(fetched) };
  } catch (error) {
    console.error("[mobile-api] REKAZ_FETCH_FAILED", error);
    return rekazFailure(
      error,
      "REKAZ_FETCH_FAILED",
      "تعذّر الاتصال بمنصة ركاز — حاولي بعد قليل",
    );
  }

  try {
    const changes = await applyRekazSync({
      reservations: fetched.reservations,
      window: fetched.window,
      session: auth.session,
    });
    return mobileData({
      syncedAt: new Date().toISOString(),
      window: fetched.window,
      changes,
      lastSync: await lastCompletedRun(),
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("REKAZ_SYNC_IN_PROGRESS")) {
      // Concurrent pulls are serialised by a tenant advisory lock; a caller
      // that lands on a running sync is told so rather than starting another.
      return mobileError(
        409,
        "REKAZ_SYNC_IN_PROGRESS",
        "هناك عملية سحب جارية بالفعل",
      );
    }
    return mobileServerError(
      error,
      "REKAZ_APPLY_FAILED",
      "تعذّر تطبيق تغييرات ركاز بأمان",
    );
  }
}
