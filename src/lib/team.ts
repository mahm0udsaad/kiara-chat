/**
 * Owner-only team administration: create staff logins and suspend/restore them.
 * There is deliberately no self-registration — an account only exists because
 * an admin created it here. Callers MUST already be authorized as an admin;
 * the API routes enforce that before calling in.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import type { AgentInfo } from "@/lib/types";

export interface TeamMemberRow extends AgentInfo {
  userId: string;
  createdAt: string | null;
}

/** Everyone on the team, active or suspended (the admin view). */
export async function listTeam(): Promise<TeamMemberRow[]> {
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("team_members")
    .select("id, user_id, role, full_name, is_active, created_at")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .order("created_at");

  return Promise.all(
    (data ?? []).map(async (m) => {
      let email: string | null = null;
      try {
        const u = await admin.auth.admin.getUserById(m.user_id as string);
        email = u.data.user?.email ?? null;
      } catch {
        /* deleted auth user — keep the row visible so it can be cleaned up */
      }
      const fullName = ((m.full_name as string) || "").trim();
      return {
        id: m.id as string,
        userId: m.user_id as string,
        role: m.role as string,
        email,
        fullName: fullName || null,
        isActive: Boolean(m.is_active),
        createdAt: (m.created_at as string) ?? null,
      };
    })
  );
}

export async function createTeamMember(input: {
  email: string;
  password: string;
  fullName: string;
  role: "admin" | "agent";
}): Promise<TeamMemberRow> {
  const admin = getAdminSupabaseClient();
  const email = input.email.trim().toLowerCase();

  const { data: created, error: authErr } = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true, // no invite mail: the owner hands over the password
  });
  if (authErr || !created?.user) {
    throw new Error(authErr?.message || "تعذّر إنشاء الحساب");
  }

  const { data: member, error: memberErr } = await admin
    .from("team_members")
    .insert({
      restaurant_id: KIARA_RESTAURANT_ID,
      user_id: created.user.id,
      role: input.role,
      full_name: input.fullName.trim(),
      is_active: true,
      is_available: true,
    })
    .select("id, role, full_name, is_active, created_at")
    .single();

  if (memberErr) {
    // Don't strand an auth user with no membership row.
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
    throw new Error(memberErr.message);
  }

  return {
    id: member.id as string,
    userId: created.user.id,
    role: member.role as string,
    email,
    fullName: ((member.full_name as string) || "").trim() || null,
    isActive: true,
    createdAt: (member.created_at as string) ?? null,
  };
}

/** Suspend or restore access. Suspending keeps history/attribution intact. */
export async function setTeamMemberActive(
  teamMemberId: string,
  isActive: boolean
): Promise<void> {
  const { error } = await getAdminSupabaseClient()
    .from("team_members")
    .update({ is_active: isActive })
    .eq("id", teamMemberId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID);
  if (error) throw new Error(error.message);
}

/** Reset a member's password to one the owner chooses. */
export async function resetTeamMemberPassword(
  userId: string,
  password: string
): Promise<void> {
  const { error } = await getAdminSupabaseClient().auth.admin.updateUserById(userId, {
    password,
  });
  if (error) throw new Error(error.message);
}
