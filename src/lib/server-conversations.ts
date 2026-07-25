/**
 * Server-side write path for Kiara conversations/messages. Used by the OpenWA
 * ingest webhook (a trusted server-to-server call, so it uses the service-role
 * client and is always pinned to Kiara's tenant). Mirrors the parent app's
 * findOrCreate + saveMessage, keyed on the WhatsApp message id.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";

export async function findOrCreateConversation(
  customerPhone: string
): Promise<{ id: string; is_new: boolean }> {
  const admin = getAdminSupabaseClient();
  const { data: existing } = await admin
    .from("conversations")
    .select("id")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .eq("customer_phone", customerPhone)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) return { id: existing.id as string, is_new: false };

  const now = new Date().toISOString();
  const { data: created, error } = await admin
    .from("conversations")
    .insert({
      restaurant_id: KIARA_RESTAURANT_ID,
      customer_phone: customerPhone,
      status: "active",
      started_at: now,
      last_message_at: now,
      last_inbound_at: null,
    })
    .select("id")
    .single();

  if (error || !created) {
    throw new Error(`Failed to create conversation: ${error?.message}`);
  }
  return { id: created.id as string, is_new: true };
}

/** Idempotency check — the WhatsApp message id lives in external_message_sid. */
export async function hasMessageWithSid(sid: string): Promise<boolean> {
  const { data } = await getAdminSupabaseClient()
    .from("messages")
    .select("id")
    .eq("external_message_sid", sid)
    .maybeSingle();
  return Boolean(data?.id);
}

export async function saveMessage(params: {
  conversationId: string;
  role: "customer" | "agent" | "system";
  content: string;
  messageType: string;
  externalMessageSid: string;
  metadata?: Record<string, unknown>;
  deliveryStatus?: string;
  /** Original WhatsApp send time — keeps history-backfilled messages in order. */
  createdAt?: string;
}): Promise<string | null> {
  const { data, error } = await getAdminSupabaseClient()
    .from("messages")
    .insert({
      conversation_id: params.conversationId,
      role: params.role,
      content: params.content,
      message_type: params.messageType,
      metadata: params.metadata ?? {},
      external_message_sid: params.externalMessageSid,
      channel: "whatsapp",
      delivery_status: params.deliveryStatus ?? "received",
      ...(params.createdAt ? { created_at: params.createdAt } : {}),
    })
    .select("id")
    .single();
  if (error) {
    // Unique-violation on external_message_sid => a concurrent dupe; treat as no-op.
    if (error.code === "23505") return null;
    throw new Error(`saveMessage failed: ${error.message}`);
  }
  return (data?.id as string) ?? null;
}

/** Bump activity after a message lands. Increments unread for inbound. */
export async function bumpConversationActivity(
  conversationId: string,
  opts: { inbound: boolean }
): Promise<void> {
  const admin = getAdminSupabaseClient();
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { last_message_at: now };
  if (opts.inbound) {
    patch.last_inbound_at = now;
    const { data } = await admin
      .from("conversations")
      .select("unread_count")
      .eq("id", conversationId)
      .maybeSingle();
    patch.unread_count = ((data?.unread_count as number) ?? 0) + 1;
  }
  await admin.from("conversations").update(patch).eq("id", conversationId);
}

/**
 * Flag a conversation as handled directly in the WhatsApp app (a fromMe message
 * our app did not send). Stored in metadata so no schema change is needed; the
 * inbox card shows the green "handled on WhatsApp" state from this flag.
 */
export async function markHandledOnWhatsApp(
  conversationId: string
): Promise<void> {
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("conversations")
    .select("metadata")
    .eq("id", conversationId)
    .maybeSingle();
  const metadata = {
    ...((data?.metadata as Record<string, unknown>) ?? {}),
    handled_on_whatsapp: true,
    handled_on_whatsapp_at: new Date().toISOString(),
  };
  await admin.from("conversations").update({ metadata }).eq("id", conversationId);
}

export async function updateDeliveryStatus(
  externalMessageSid: string,
  status: string
): Promise<void> {
  await getAdminSupabaseClient()
    .from("messages")
    .update({ delivery_status: status })
    .eq("external_message_sid", externalMessageSid);
}
