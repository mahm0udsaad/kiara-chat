import {
  deleteDistrict,
  DistrictError,
  parseDistrictName,
  parseTripPrice,
  updateDistrict,
} from "@/lib/districts";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function authorizeAdmin(request: Request) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return { response: auth.response };
  if (auth.session.role !== "admin") {
    return {
      response: mobileError(403, "DISTRICTS_FORBIDDEN", "إدارة الأحياء للمالكة والمديرة فقط"),
    };
  }
  return { session: auth.session };
}

/**
 * A new fare applies to orders that choose the district from now on; trips
 * already priced keep theirs.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, response } = await authorizeAdmin(request);
  if (!session) return response;
  const { id } = await params;
  if (!UUID.test(id)) return mobileError(404, "DISTRICT_NOT_FOUND", "الحي غير موجود");

  const body = await request.json().catch(() => null);
  try {
    const patch: { name?: string; tripPrice?: number; isActive?: boolean } = {};
    if (body?.name !== undefined) patch.name = parseDistrictName(body.name);
    if (body?.tripPrice !== undefined) patch.tripPrice = parseTripPrice(body.tripPrice);
    if (typeof body?.isActive === "boolean") patch.isActive = body.isActive;
    if (!Object.keys(patch).length) {
      return mobileError(400, "EMPTY_DISTRICT_PATCH", "لا يوجد تعديل");
    }
    const district = await updateDistrict(session.userId, id, patch);
    return mobileData({ district });
  } catch (error) {
    if (error instanceof DistrictError) {
      return mobileError(error.status, "DISTRICT_INVALID", error.message);
    }
    return mobileServerError(error, "DISTRICT_UPDATE_FAILED", "تعذّر حفظ الحي");
  }
}

/** Deletes an unused district; archives one that past orders name. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, response } = await authorizeAdmin(request);
  if (!session) return response;
  const { id } = await params;
  if (!UUID.test(id)) return mobileError(404, "DISTRICT_NOT_FOUND", "الحي غير موجود");

  try {
    return mobileData(await deleteDistrict(session.userId, id));
  } catch (error) {
    if (error instanceof DistrictError) {
      return mobileError(error.status, "DISTRICT_INVALID", error.message);
    }
    return mobileServerError(error, "DISTRICT_DELETE_FAILED", "تعذّر حذف الحي");
  }
}
