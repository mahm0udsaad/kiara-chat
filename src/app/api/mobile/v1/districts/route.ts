import {
  createDistrict,
  DistrictError,
  listDistricts,
  parseDistrictName,
  parseTripPrice,
} from "@/lib/districts";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";

export const dynamic = "force-dynamic";

/**
 * Every employee picks a district on an order, so every employee reads the
 * list. Fares, and archived districts, are admin-only.
 */
export async function GET(request: Request) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;
  const isAdmin = auth.session.role === "admin";
  try {
    const districts = await listDistricts({ activeOnly: !isAdmin, withPrice: isAdmin });
    return mobileData({ districts });
  } catch (error) {
    return mobileServerError(error, "DISTRICTS_FAILED", "تعذّر تحميل الأحياء");
  }
}

export async function POST(request: Request) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;
  if (auth.session.role !== "admin") {
    return mobileError(403, "DISTRICTS_FORBIDDEN", "إدارة الأحياء للمالكة والمديرة فقط");
  }

  const body = await request.json().catch(() => null);
  try {
    const district = await createDistrict(auth.session.userId, {
      name: parseDistrictName(body?.name),
      tripPrice: parseTripPrice(body?.tripPrice),
    });
    return mobileData({ district }, 201);
  } catch (error) {
    if (error instanceof DistrictError) {
      return mobileError(error.status, "DISTRICT_INVALID", error.message);
    }
    return mobileServerError(error, "DISTRICT_CREATE_FAILED", "تعذّر إضافة الحي");
  }
}
