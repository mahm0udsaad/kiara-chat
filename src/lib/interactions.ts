/**
 * Server-side inbox interactions for Kiara: ownership (Take/Transfer/Release via
 * the shared atomic claim_conversation RPC), CS status, and agent replies
 * (through the transport layer). Callers must be authorized Kiara members —
 * the API routes enforce that; these helpers assume it and use the admin client.
 */
import { after } from "next/server";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import { isOpenWaConfigured, openWaTransport } from "@/lib/transport/openwa";
import {
  uploadBase64Media,
  messageTypeFromContentType,
  MAX_MEDIA_BYTES,
} from "@/lib/storage-media";
import type {
  BookingStage,
  CsStatus,
  AgentInfo,
  Conversation,
  ConversationSection,
} from "@/lib/types";

export type { CsStatus, AgentInfo };

/**
 * Deliver an already-recorded message and settle its status, after the HTTP
 * response has been sent. The provider call is the slowest thing on the send
 * path and nothing in the UI needs to wait for it — the message row already
 * exists, so the thread renders it immediately as "queued" and the UPDATE
 * streams the final status in over realtime.
 */
function deliverInBackground(
  messageId: string,
  conversationId: string,
  conversationMetadata: Record<string, unknown> | null,
  send: () => Promise<{ providerMessageId?: string | null }>
): void {
  after(async () => {
    const admin = getAdminSupabaseClient();
    let sent = false;
    let providerId: string | null = null;
    if (isOpenWaConfigured()) {
      try {
        const r = await send();
        providerId = r.providerMessageId || null;
        sent = true;
      } catch {
        sent = false;
      }
    }

    await Promise.all([
      admin
        .from("messages")
        .update({
          delivery_status: sent
            ? "sent"
            : isOpenWaConfigured()
              ? "failed"
              : "queued",
          external_message_sid: providerId,
        })
        .eq("id", messageId),
      // Bump activity + clear "handled on WhatsApp" (now handled in-app).
      admin
        .from("conversations")
        .update({
          last_message_at: new Date().toISOString(),
          metadata: { ...(conversationMetadata ?? {}), handled_on_whatsapp: false },
        })
        .eq("id", conversationId),
    ]);
  });
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

/** Clear the unread badge when an agent opens the thread. */
export async function markConversationRead(conversationId: string) {
  await getAdminSupabaseClient()
    .from("conversations")
    .update({ unread_count: 0 })
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID);
}

/** Release = back to the shared queue (unassigned). */
export async function releaseConversation(conversationId: string) {
  await getAdminSupabaseClient()
    .from("conversations")
    .update({ handler_mode: "unassigned", assigned_to: null, assigned_at: null })
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID);
}

/**
 * Name the customer by hand. WhatsApp only ever gives us whatever display name
 * the sender set — often nothing, sometimes "ا" — while staff know exactly who
 * these people are. Null clears it, and the inbox falls back to the number.
 *
 * Unlike the ingest path, this overwrites: it's a deliberate correction.
 */
export async function setCustomerName(conversationId: string, name: string | null) {
  await getAdminSupabaseClient()
    .from("conversations")
    .update({ customer_name: name })
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

/**
 * Set the operational booking stage without a schema migration. The final
 * stage resolves the conversation; moving to any earlier stage reopens it.
 */
export async function setBookingStage(
  conversationId: string,
  bookingStage: BookingStage
) {
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("conversations")
    .select("metadata")
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  const completed = bookingStage === "completed";
  const metadata = {
    ...((data?.metadata as Record<string, unknown>) ?? {}),
    booking_stage: bookingStage,
    cs_status: completed ? "resolved" : "open",
  };
  const { error } = await admin
    .from("conversations")
    .update({ metadata, status: completed ? "resolved" : "active" })
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID);
  if (error) throw new Error(error.message);
}

/** Read-modify-write one key of a conversation's metadata. Owner-only callers. */
async function patchMetadata(
  conversationId: string,
  patch: Record<string, unknown>
): Promise<Conversation | null> {
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("conversations")
    .select("metadata")
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  const metadata = { ...((data?.metadata as Record<string, unknown>) ?? {}), ...patch };
  for (const [k, v] of Object.entries(patch)) if (v === null) delete metadata[k];

  const { data: updated } = await admin
    .from("conversations")
    .update({ metadata })
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .select(
      "id, restaurant_id, customer_phone, customer_name, status, started_at, last_message_at, last_inbound_at, handler_mode, assigned_to, unread_count, metadata"
    )
    .maybeSingle();
  return (updated as Conversation) ?? null;
}

/** Tag the chat with the desk that handles it (الطلبات / الردود). Owner-only. */
export async function setConversationSection(
  conversationId: string,
  section: ConversationSection | null
) {
  return patchMetadata(conversationId, { section });
}

/**
 * Route a chat exclusively to one employee — nobody else sees it or is notified
 * about it (lib/conversation-meta.ts). Routing also assigns the chat to them so
 * it lands under "لي" with their name on it; un-routing leaves ownership alone,
 * since the assignee is usually still the right person to answer.
 *
 * Writes with the admin client on purpose: the owner may have no team_members
 * row of their own, so the claim RPC (which needs the caller's member id) is
 * not an option here.
 */
export async function setConversationRouting(
  conversationId: string,
  targetTeamMemberId: string | null
) {
  const conversation = await patchMetadata(conversationId, {
    routed_to: targetTeamMemberId,
  });
  if (!targetTeamMemberId) return conversation;

  const { data } = await getAdminSupabaseClient()
    .from("conversations")
    .update({
      assigned_to: targetTeamMemberId,
      handler_mode: "human",
      assigned_at: new Date().toISOString(),
    })
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .select(
      "id, restaurant_id, customer_phone, customer_name, status, started_at, last_message_at, last_inbound_at, handler_mode, assigned_to, unread_count, metadata"
    )
    .maybeSingle();
  return ((data as Conversation) ?? conversation) ?? null;
}

/** Send an agent reply through the transport layer; records it either way. */
export async function sendReply(
  conversationId: string,
  sender: { email: string | null; teamMemberId?: string | null },
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
      // Stable attribution for per-employee reporting; the email in metadata
      // is only a human-readable fallback.
      sender_team_member_id: sender.teamMemberId ?? null,
      channel: "whatsapp",
      delivery_status: "queued",
    })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to record reply: ${error.message}`);

  const messageId = msg!.id as string;
  deliverInBackground(
    messageId,
    conversationId,
    conv.metadata as Record<string, unknown> | null,
    () => openWaTransport.sendText(conv.customer_phone as string, body)
  );

  return { messageId, sent: false };
}

/**
 * Send an image / document / voice note. Stores our own copy in the bucket
 * first so the thread renders it even if the WhatsApp send fails, then hands
 * the bytes to the transport.
 */
export async function sendMediaReply(
  conversationId: string,
  sender: { email: string | null; teamMemberId?: string | null },
  file: { buffer: Buffer; contentType: string; filename: string | null },
  caption: string
): Promise<{ messageId: string | null; sent: boolean }> {
  const admin = getAdminSupabaseClient();
  const { data: conv } = await admin
    .from("conversations")
    .select("id, customer_phone, metadata")
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  if (!conv) throw new Error("Conversation not found");

  if (file.buffer.byteLength > MAX_MEDIA_BYTES) {
    throw new Error("الملف أكبر من الحد المسموح (20 ميجابايت)");
  }

  const base64 = file.buffer.toString("base64");
  const messageType = messageTypeFromContentType(file.contentType);
  const slot = await uploadBase64Media({
    restaurantId: KIARA_RESTAURANT_ID,
    conversationId,
    contentType: file.contentType,
    base64,
    originalFilename: file.filename,
  });

  const { data: msg, error } = await admin
    .from("messages")
    .insert({
      conversation_id: conversationId,
      role: "agent",
      content: caption || "",
      message_type: messageType,
      metadata: { source: "app", sent_by_email: sender.email, media: [slot] },
      sender_team_member_id: sender.teamMemberId ?? null,
      channel: "whatsapp",
      delivery_status: "queued",
    })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to record media message: ${error.message}`);

  const messageId = msg!.id as string;
  deliverInBackground(
    messageId,
    conversationId,
    conv.metadata as Record<string, unknown> | null,
    () =>
      openWaTransport.sendMedia(conv.customer_phone as string, {
        base64,
        contentType: file.contentType,
        filename: file.filename ?? undefined,
        caption: caption || undefined,
      })
  );

  return { messageId, sent: false };
}

/** Active Kiara agents (for the transfer picker), with emails resolved. */
export async function listAgents(): Promise<AgentInfo[]> {
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("team_members")
    .select("id, user_id, role, full_name, is_active")
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
      const fullName = ((a.full_name as string) || "").trim();
      return {
        id: a.id as string,
        role: a.role as string,
        email,
        fullName: fullName || null,
        isActive: Boolean(a.is_active),
      };
    })
  );
}
