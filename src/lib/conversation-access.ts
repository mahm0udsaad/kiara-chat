/**
 * The server-side half of exclusive routing.
 *
 * Hiding a routed chat from the inbox list is not enough on its own — the
 * per-conversation API routes take an id straight from the client, so each one
 * asks here before doing anything. Admins are waved through without a query;
 * for an employee this costs one primary-key lookup.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { canViewConversation } from "@/lib/conversation-meta";
import { KIARA_RESTAURANT_ID, type KiaraSession } from "@/lib/tenant";

/**
 * Returns a 403 response when this conversation was routed to someone else, or
 * null when the caller may proceed. A missing row is *not* this guard's call —
 * the handler answers for it (404/empty), so nothing here leaks which ids exist.
 */
export async function denyIfRouted(
  conversationId: string,
  session: KiaraSession
): Promise<NextResponse | null> {
  if (session.role === "admin") return null;

  const supabase = await createServerSupabaseClient();
  const { data } = await supabase
    .from("conversations")
    .select("metadata")
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  if (!data) return null;

  const allowed = canViewConversation(data as { metadata: Record<string, unknown> | null }, {
    isAdmin: false,
    teamMemberId: session.teamMemberId,
  });
  return allowed
    ? null
    : NextResponse.json(
        { error: "هذه المحادثة موجّهة إلى موظف آخر" },
        { status: 403 }
      );
}
