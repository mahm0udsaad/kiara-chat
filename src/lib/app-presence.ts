import "server-only";

import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID, type KiaraSession } from "@/lib/tenant";

export type EmployeeAppState = "active" | "background";
export type EmployeeAppPlatform = "ios" | "android" | "web";

/**
 * A gap this long between beats means the app was closed or asleep rather than
 * watched, so it buys no time. Two heartbeat intervals plus slack, so one
 * dropped beat on a bad connection does not fracture a continuous stretch.
 */
export const PRESENCE_IDLE_CUTOFF_SECONDS = 120;

/**
 * Record a best-effort authenticated heartbeat for an operations employee.
 * The server chooses the member and tenant from the verified session; neither
 * identity is accepted from the client.
 *
 * The function behind this also credits the elapsed time to the employee's day
 * — see `record_employee_app_presence`. It accumulates rather than logging each
 * beat, and does both writes atomically so two devices beating at the same
 * moment cannot each credit the same gap.
 */
export async function recordEmployeeAppPresence(input: {
  session: KiaraSession;
  state: EmployeeAppState;
  platform: EmployeeAppPlatform;
  appVersion?: string | null;
}): Promise<void> {
  if (!input.session.teamMemberId) return;
  const { error } = await getAdminSupabaseClient().rpc(
    "record_employee_app_presence",
    {
      p_team_member_id: input.session.teamMemberId,
      p_restaurant_id: KIARA_RESTAURANT_ID,
      p_state: input.state,
      p_platform: input.platform,
      p_app_version: input.appVersion?.trim().slice(0, 40) || null,
      p_idle_cutoff_seconds: PRESENCE_IDLE_CUTOFF_SECONDS,
    },
  );
  if (error) throw new Error(error.message);
}
