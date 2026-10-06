import {
  LocationRequestError,
  requestDriverLocationPermission,
} from "@/lib/driver-tracking";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";

/**
 * POST /api/mobile/v1/orders/[id]/tracking/location-request — sends the
 * driver the "please allow location" notification, worded exactly as the
 * employee left it in the composer.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => null)) as {
    title?: unknown;
    body?: unknown;
  } | null;
  if (typeof body?.title !== "string" || typeof body?.body !== "string") {
    return mobileError(400, "INVALID_REQUEST", "title and body are required");
  }

  const { id } = await params;
  try {
    const delivery = await requestDriverLocationPermission({
      orderId: id,
      title: body.title,
      body: body.body,
      actor: {
        userId: auth.session.userId,
        teamMemberId: auth.session.teamMemberId,
        role: auth.session.role,
      },
    });
    return mobileData({ delivery });
  } catch (error) {
    if (error instanceof LocationRequestError) {
      return mobileError(error.status, error.code, error.message);
    }
    return mobileServerError(
      error,
      "LOCATION_REQUEST_FAILED",
      "Unable to send the location request",
    );
  }
}
