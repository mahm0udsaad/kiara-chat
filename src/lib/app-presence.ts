import "server-only";

import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID, type KiaraSession } from "@/lib/tenant";

export type EmployeeAppState = "active" | "background";
export type EmployeeAppPlatform = "ios" | "android" | "web";

/**
 * Record a best-effort authenticated heartbeat for an operations employee.
 * The server chooses the member and tenant from the verified session; neither
 * identity is accepted from the client.
 */
export async function recordEmployeeAppPresence(input: {
  session: KiaraSession;
  state: EmployeeAppState;
  platform: EmployeeAppPlatform;
  appVersion?: string | null;
}): Promise<void> {
  if (!input.session.teamMemberId) return;
  const now = new Date().toISOString();
  const { error } = await getAdminSupabaseClient()
    .from("team_member_app_presence")
    .upsert(
      {
        team_member_id: input.session.teamMemberId,
        restaurant_id: KIARA_RESTAURANT_ID,
        state: input.state,
        platform: input.platform,
        app_version: input.appVersion?.trim().slice(0, 40) || null,
        last_seen_at: now,
        ...(input.state === "active" ? { last_active_at: now } : {}),
      },
      { onConflict: "team_member_id" },
    );
  if (error) throw new Error(error.message);
}
