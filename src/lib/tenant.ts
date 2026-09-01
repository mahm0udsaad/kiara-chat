import { cache } from "react";
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
  /** True only when auth.uid() is restaurants.owner_id for the Kiara tenant. */
  isOwner: boolean;
  email: string | null;
  /**
   * The caller's `team_members.id`, resolved as part of the same lookup that
   * authorizes them. Null for an owner with no membership row. Callers must not
   * re-query this — that was a third round trip on the send path.
   */
  teamMemberId: string | null;
}

/**
 * Verified identity from the current access token.
 *
 * `getClaims()` validates the JWT signature and expiry locally when the
 * project uses asymmetric signing keys. Unlike `getUser()`, it does not make
 * an unconditional Auth HTTP request on every page navigation.
 */
async function getVerifiedIdentity(): Promise<{
  userId: string;
  email: string | null;
} | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error) return null;

  const userId = data?.claims?.sub;
  if (typeof userId !== "string" || !userId) return null;

  const email = data.claims.email;
  return {
    userId,
    email: typeof email === "string" ? email : null,
  };
}

/**
 * Resolve AND authorize the signed-in user against the pinned Kiara tenant.
 * Returns null unless the user is Kiara's owner or an active team member.
 * Uses the RLS-respecting client (users can read their own membership row and
 * owners their restaurant), so this works without the service-role key.
 */
export const getKiaraSession = cache(async function getKiaraSession(): Promise<KiaraSession | null> {
  const supabase = await createServerSupabaseClient();
  const identity = await getVerifiedIdentity();
  if (!identity) return null;

  // Both lookups run concurrently: the member path is the common case, but
  // testing it first made the owner pay two serial round trips on every request.
  const [{ data: member }, { data: owned }] = await Promise.all([
    supabase
      .from("team_members")
      .select("id, role")
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .eq("user_id", identity.userId)
      .eq("is_active", true)
      .maybeSingle(),
    supabase
      .from("restaurants")
      .select("id")
      .eq("id", KIARA_RESTAURANT_ID)
      .eq("owner_id", identity.userId)
      .maybeSingle(),
  ]);

  // Member wins on role resolution, but an owner who is also a member keeps
  // admin either way.
  if (member) {
    const role: AgentRole =
      member.role === "admin" || owned ? "admin" : "agent";
    return {
      userId: identity.userId,
      role,
      isOwner: Boolean(owned),
      email: identity.email,
      teamMemberId: (member.id as string) ?? null,
    };
  }

  if (owned) {
    return {
      userId: identity.userId,
      role: "admin",
      isOwner: true,
      email: identity.email,
      teamMemberId: null,
    };
  }

  return null;
});

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

/** Reports contain employee-accountability data and belong to Hanan alone. */
export async function requireOwner(): Promise<KiaraSession> {
  const session = await requireKiaraSession();
  if (!session.isOwner) redirect("/inbox");
  return session;
}
