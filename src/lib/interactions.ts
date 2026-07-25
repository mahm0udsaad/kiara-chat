/**
 * Server-side inbox interactions for Kiara: ownership (Take/Transfer/Release via
 * the shared atomic claim_conversation RPC), CS status, and agent replies
 * (through the transport layer). Callers must be authorized Kiara members —
 * the API routes enforce that; these helpers assume it and use the admin client.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import { isOpenWaConfigured, openWaTransport } from "@/lib/transport/openwa";
import type { CsStatus, AgentInfo } from "@/lib/types";

export type { CsStatus, AgentInfo };

/** Resolve the caller's team_members.id for Kiara (agents + owner-as-admin). */
export async function getMyTeamMemberId(userId: string): Promise<string | null> {
  const { data } = await getAdminSupabaseClient()
    .from("team_members")
    .select("id")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  return (data?.id as string) ?? null;
}

/**
 * Take = self-claim (atomic first-writer-wins via the shared RPC).
 * Uses the AUTHED client — claim_conversation validates auth.uid() is a member,
 * so it must run as the caller (the service-role client has no auth.uid()).
 */
export async function takeConversation(conversationId: string, teamMemberId: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("claim_conversation", {
    p_conversation_id: conversationId,
    p_mode: "human",
    p_team_member_id: teamMemberId,
  });
  if (error) throw new Error(error.message);
  return data;
}

/** Transfer = force-reassign to another agent (authed, same reason as Take). */
export async function transferConversation(
  conversationId: string,
  myTeamMemberId: string,
  targetTeamMemberId: string
) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("claim_conversation", {
    p_conversation_id: conversationId,
    p_mode: "human",
    p_team_member_id: myTeamMemberId,
    p_force: true,
    p_assign_to_team_member_id: targetTeamMemberId,
  });
  if (error) throw new Error(error.message);
  return data;
}

/** Release = back to the shared queue (unassigned). */
export async function releaseConversation(conversationId: string) {
  await getAdminSupabaseClient()
    .from("conversations")
    .update({ handler_mode: "unassigned", assigned_to: null, assigned_at: null })
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID);
}

/** Set Kiara CS status; mirrors the DB status column to satisfy its CHECK. */
export async function setCsStatus(conversationId: string, csStatus: CsStatus) {
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("conversations")
    .select("metadata")
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  const metadata = {
    ...((data?.metadata as Record<string, unknown>) ?? {}),
    cs_status: csStatus,
  };
  const dbStatus = csStatus === "resolved" ? "resolved" : "active";
  await admin
    .from("conversations")
    .update({ metadata, status: dbStatus })
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID);
}

/** Send an agent reply through the transport layer; records it either way. */
export async function sendReply(
  conversationId: string,
  sender: { email: string | null },
  body: string
): Promise<{ messageId: string | null; sent: boolean }> {
  const admin = getAdminSupabaseClient();
  const { data: conv } = await admin
    .from("conversations")
    .select("id, customer_phone, metadata")
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  if (!conv) throw new Error("Conversation not found");

  const { data: msg, error } = await admin
    .from("messages")
    .insert({
      conversation_id: conversationId,
      role: "agent",
      content: body,
      message_type: "text",
      metadata: { source: "app", sent_by_email: sender.email },
      channel: "whatsapp",
      delivery_status: "queued",
    })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to record reply: ${error.message}`);

  let sent = false;
  let providerId: string | null = null;
  if (isOpenWaConfigured()) {
    try {
      const r = await openWaTransport.sendText(conv.customer_phone as string, body);
      providerId = r.providerMessageId || null;
      sent = true;
    } catch {
      sent = false;
    }
  }

  await admin
    .from("messages")
    .update({
      delivery_status: sent ? "sent" : isOpenWaConfigured() ? "failed" : "queued",
      external_message_sid: providerId,
    })
    .eq("id", msg!.id);

  // Bump activity + clear "handled on WhatsApp" (now handled in-app).
  const convMeta = {
    ...((conv.metadata as Record<string, unknown>) ?? {}),
    handled_on_whatsapp: false,
  };
  await admin
    .from("conversations")
    .update({ last_message_at: new Date().toISOString(), metadata: convMeta })
    .eq("id", conversationId);

  return { messageId: (msg?.id as string) ?? null, sent };
}

/** Active Kiara agents (for the transfer picker), with emails resolved. */
export async function listAgents(): Promise<AgentInfo[]> {
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("team_members")
    .select("id, user_id, role")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .eq("is_active", true)
    .order("created_at");
  const rows = data ?? [];
  return Promise.all(
    rows.map(async (a) => {
      let email: string | null = null;
      try {
        const u = await admin.auth.admin.getUserById(a.user_id as string);
        email = u.data.user?.email ?? null;
      } catch {
        /* ignore */
      }
      return { id: a.id as string, role: a.role as string, email };
    })
  );
}
