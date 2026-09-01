import {
  type EmployeeAppPlatform,
  type EmployeeAppState,
  recordEmployeeAppPresence,
} from "@/lib/app-presence";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";

const STATES = new Set<EmployeeAppState>(["active", "background"]);
const PLATFORMS = new Set<EmployeeAppPlatform>(["ios", "android"]);

export async function POST(request: Request) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;
  if (!auth.session.teamMemberId) {
    return mobileError(403, "TEAM_MEMBER_REQUIRED", "عضوية الفريق مطلوبة");
  }

  const body = (await request.json().catch(() => null)) as {
    state?: unknown;
    platform?: unknown;
    appVersion?: unknown;
  } | null;
  const state = body?.state;
  const platform = body?.platform;
  if (
    typeof state !== "string" ||
    !STATES.has(state as EmployeeAppState) ||
    typeof platform !== "string" ||
    !PLATFORMS.has(platform as EmployeeAppPlatform)
  ) {
    return mobileError(400, "INVALID_HEARTBEAT", "بيانات النشاط غير صحيحة");
  }

  try {
    await recordEmployeeAppPresence({
      session: auth.session,
      state: state as EmployeeAppState,
      platform: platform as EmployeeAppPlatform,
      appVersion: typeof body?.appVersion === "string" ? body.appVersion : null,
    });
    return mobileData({ receivedAt: new Date().toISOString() });
  } catch (error) {
    return mobileServerError(error, "HEARTBEAT_FAILED", "تعذّر تسجيل نشاط التطبيق");
  }
}
