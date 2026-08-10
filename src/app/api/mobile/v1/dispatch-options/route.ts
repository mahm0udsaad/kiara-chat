import {
  getDispatchSettings,
  listDrivers,
  listSpecialists,
} from "@/lib/dispatch";
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
    const [specialists, drivers, settings] = await Promise.all([
      listSpecialists({ activeOnly: true }),
      listDrivers({ activeOnly: true }),
      auth.session.role === "admin"
        ? getDispatchSettings()
        : Promise.resolve(null),
    ]);
    return mobileData({ specialists, drivers, settings });
  } catch (error) {
    return mobileServerError(
      error,
      "DISPATCH_OPTIONS_FAILED",
      "Unable to load specialists and drivers"
    );
  }
}
