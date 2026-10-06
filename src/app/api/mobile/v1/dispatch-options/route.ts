import {
  getDispatchSettings,
  listDrivers,
  listSpecialists,
} from "@/lib/dispatch";
import { listDistricts } from "@/lib/districts";
import { canSeeTripCost } from "@/lib/orders-visibility";
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
    const [specialists, drivers, settings, districts] = await Promise.all([
      listSpecialists({ activeOnly: true }),
      listDrivers({ activeOnly: true }),
      auth.session.role === "admin"
        ? getDispatchSettings()
        : Promise.resolve(null),
      // Every employee may pick one; only the owner sees what it costs.
      listDistricts({ activeOnly: true, withPrice: canSeeTripCost(auth.session) }),
    ]);
    return mobileData({ specialists, drivers, settings, districts });
  } catch (error) {
    return mobileServerError(
      error,
      "DISPATCH_OPTIONS_FAILED",
      "Unable to load specialists and drivers"
    );
  }
}
