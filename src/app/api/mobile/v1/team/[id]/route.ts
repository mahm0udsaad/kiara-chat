import { authorizeMobileRequest, mobileData, mobileError, mobileServerError } from "@/lib/mobile/http";
import { setTeamMemberPermissions } from "@/lib/permissions-store";

/**
 * PATCH /api/mobile/v1/team/:id — grant or revoke one employee's extra
 * permissions. Owner-only. Deliberately narrower than the web route: this one
 * only ever touches `permissions` (no password reset, no active/suspend) —
 * account administration stays a web-only task for now.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;
  if (auth.session.role !== "admin") {
    return mobileError(403, "FORBIDDEN", "Owner-only");
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  if (!Array.isArray(body?.permissions)) {
    return mobileError(400, "BAD_PERMISSIONS", "permissions must be an array");
  }
  const permissions = body.permissions.filter((p: unknown): p is string => typeof p === "string");

  try {
    await setTeamMemberPermissions(id, permissions);
    return mobileData({ ok: true });
  } catch (error) {
    return mobileServerError(error, "PERMISSIONS_UPDATE_FAILED", "Unable to update permissions");
  }
}
