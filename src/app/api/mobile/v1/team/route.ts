import { authorizeMobileRequest, mobileData, mobileError, mobileServerError } from "@/lib/mobile/http";
import { listTeam } from "@/lib/team";

/**
 * GET /api/mobile/v1/team — the owner's employee list, for the account tab's
 * permissions screen. Owner-only: the same information the web /team page
 * shows, so an employee's own account isn't a way to enumerate the team.
 */
export async function GET(request: Request) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;
  if (auth.session.role !== "admin") {
    return mobileError(403, "FORBIDDEN", "Owner-only");
  }

  try {
    return mobileData({ team: await listTeam() });
  } catch (error) {
    return mobileServerError(error, "TEAM_FETCH_FAILED", "Unable to load team");
  }
}
