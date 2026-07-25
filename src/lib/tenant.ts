import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Kiara Chat is a SINGLE-TENANT dedicated app over the shared whatsapp-cs
 * database. Every data path is pinned to this one restaurant id and every
 * request is authorized against it. There is deliberately no tenant switching
 * and no way for the client to supply a tenant id.
 */
export const KIARA_RESTAURANT_ID =
  process.env.KIARA_RESTAURANT_ID ?? "2ba8f6c8-aff9-4147-8f13-cdcb732de698";

export type AgentRole = "admin" | "agent";

export interface KiaraSession {
  userId: string;
  role: AgentRole;
  email: string | null;
}

export async function getCurrentUser() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * Resolve AND authorize the signed-in user against the pinned Kiara tenant.
 * Returns null unless the user is Kiara's owner or an active team member.
 * Uses the RLS-respecting client (users can read their own membership row and
 * owners their restaurant), so this works without the service-role key.
 */
export async function getKiaraSession(): Promise<KiaraSession | null> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Member path — an active team_members row for this tenant.
  const { data: member } = await supabase
    .from("team_members")
    .select("role")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (member) {
    const role: AgentRole = member.role === "admin" ? "admin" : "agent";
    return { userId: user.id, role, email: user.email ?? null };
  }

  // Owner path — the restaurant's owner_id.
  const { data: owned } = await supabase
    .from("restaurants")
    .select("id")
    .eq("id", KIARA_RESTAURANT_ID)
    .eq("owner_id", user.id)
    .maybeSingle();

  if (owned) {
    return { userId: user.id, role: "admin", email: user.email ?? null };
  }

  return null;
}

/** Page guard: redirect to /login unless the caller is an authorized Kiara user. */
export async function requireKiaraSession(): Promise<KiaraSession> {
  const session = await getKiaraSession();
  if (!session) redirect("/login");
  return session;
}

/** Page guard: redirect non-admins to the inbox. */
export async function requireAdmin(): Promise<KiaraSession> {
  const session = await requireKiaraSession();
  if (session.role !== "admin") redirect("/inbox");
  return session;
}
