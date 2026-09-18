/**
 * Owner-granted extra permissions, per team member — the storage.
 *
 * No new table: `team_members` has no `metadata` column of its own, and
 * every other per-restaurant setting in this app already lives on
 * `restaurants.metadata` (campaigns, template images, …), so grants live
 * there too, keyed by team member id. Server-only — pulls in
 * `getAdminSupabaseClient` — so route handlers and `@/lib/team` import this,
 * never a client component (which wants `@/lib/permissions` instead, for the
 * plain constants).
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import { isPermissionKey, type PermissionKey } from "@/lib/permissions";

async function readGrants(): Promise<{
  meta: Record<string, unknown>;
  grants: Record<string, string[]>;
}> {
  const { data } = await getAdminSupabaseClient()
    .from("restaurants")
    .select("metadata")
    .eq("id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  const meta = (data?.metadata as Record<string, unknown> | null) ?? {};
  return { meta, grants: (meta.teamPermissions as Record<string, string[]>) ?? {} };
}

/** Every team member's grants, id → permission keys. For the team screen. */
export async function allTeamPermissions(): Promise<Record<string, PermissionKey[]>> {
  const { grants } = await readGrants();
  const out: Record<string, PermissionKey[]> = {};
  for (const [id, keys] of Object.entries(grants)) {
    out[id] = (keys ?? []).filter(isPermissionKey);
  }
  return out;
}

/** Replace one team member's full grant set. Owner-only — callers enforce that. */
export async function setTeamMemberPermissions(
  teamMemberId: string,
  permissions: string[],
): Promise<void> {
  const { meta, grants } = await readGrants();
  const clean = [...new Set(permissions.filter(isPermissionKey))];
  const next = { ...grants };
  if (clean.length) next[teamMemberId] = clean;
  else delete next[teamMemberId];
  const { error } = await getAdminSupabaseClient()
    .from("restaurants")
    .update({ metadata: { ...meta, teamPermissions: next } })
    .eq("id", KIARA_RESTAURANT_ID);
  if (error) throw new Error(error.message);
}

/**
 * Whether this session may perform `key` — an admin always may; an agent
 * needs it explicitly granted. `teamMemberId` is null for the owner account
 * (which has no `team_members` row), and an owner is always an admin, so this
 * only ever does a lookup for a real agent.
 */
export async function hasPermission(
  session: { role: string; teamMemberId: string | null },
  key: PermissionKey,
): Promise<boolean> {
  if (session.role === "admin") return true;
  if (!session.teamMemberId) return false;
  const { grants } = await readGrants();
  return (grants[session.teamMemberId] ?? []).includes(key);
}
