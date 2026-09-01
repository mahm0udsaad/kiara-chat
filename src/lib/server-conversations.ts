/**
 * Server-side write path for Kiara conversations/messages. Used by the OpenWA
 * ingest webhook (a trusted server-to-server call, so it uses the service-role
 * client and is always pinned to Kiara's tenant). Mirrors the parent app's
 * findOrCreate + saveMessage, keyed on the WhatsApp message id.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import { canonicalPhone } from "@/lib/phone";

/**
 * A WhatsApp display name worth storing: not blank, not just the phone number
 * (some clients set pushName to the msisdn), and short enough to be a name.
 */
function usableCustomerName(
  name: string | null | undefined,
  customerPhone: string
): string | null {
  const trimmed = (name ?? "").trim();
  if (!trimmed || trimmed.length > 80) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (digits && digits === customerPhone.replace(/\D/g, "")) return null;
  return trimmed;
}

export async function findOrCreateConversation(
  customerPhone: string,
  /** The sender's WhatsApp display name, when the engine forwarded one. */
  customerName?: string | null
): Promise<{ id: string; is_new: boolean }> {
  const canonical = canonicalPhone(customerPhone);
  if (!canonical) throw new Error("Invalid customer phone");
  const admin = getAdminSupabaseClient();
  const name = usableCustomerName(customerName, canonical);
  const { data: existing } = await admin
    .from("conversations")
    .select("id, customer_name")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .eq("customer_phone", canonical)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    // Fill the name in once; never overwrite one that's already there (it may
    // have been corrected by hand, and WhatsApp names change on a whim).
    if (name && !existing.customer_name) {
      await admin
        .from("conversations")
        .update({ customer_name: name })
        .eq("id", existing.id)
        .eq("restaurant_id", KIARA_RESTAURANT_ID);
    }
    return { id: existing.id as string, is_new: false };
  }

  const now = new Date().toISOString();
  const { data: created, error } = await admin
    .from("conversations")
    .insert({
      restaurant_id: KIARA_RESTAURANT_ID,
      customer_phone: canonical,
      customer_name: name,
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

/**
 * A WhatsApp group, as one thread.
 *
 * Groups ride the same row as a 1:1 chat: the group's jid goes in
 * `customer_phone` (it is the address the engine sends to, exactly as a phone
 * is) and the subject in `customer_name`. That keeps every existing path —
 * lookup, reply, media — working unchanged, and `metadata.chat_kind` is the
 * one bit that tells the inbox to file it under the groups tab instead of the
 * customer queue.
 */
export async function findOrCreateGroupConversation(
  chatJid: string,
  subject?: string | null
): Promise<{ id: string; is_new: boolean }> {
  const admin = getAdminSupabaseClient();
  const name = (subject ?? "").trim().slice(0, 80) || null;
  const { data: existing } = await admin
    .from("conversations")
    .select("id, customer_name, metadata")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .eq("customer_phone", chatJid)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    // Unlike a person's pushName, a group's subject is the group's real title
    // and renaming one is deliberate — so this one does follow changes.
    const metadata = (existing.metadata as Record<string, unknown>) ?? {};
    const patch: Record<string, unknown> = {};
    if (name && name !== existing.customer_name) patch.customer_name = name;
    if (metadata.chat_kind !== "group") {
      patch.metadata = { ...metadata, chat_kind: "group" };
    }
    if (Object.keys(patch).length) {
      await admin
        .from("conversations")
        .update(patch)
        .eq("id", existing.id)
        .eq("restaurant_id", KIARA_RESTAURANT_ID);
    }
    return { id: existing.id as string, is_new: false };
  }

  const now = new Date().toISOString();
  const { data: created, error } = await admin
    .from("conversations")
    .insert({
      restaurant_id: KIARA_RESTAURANT_ID,
      customer_phone: chatJid,
      customer_name: name,
      status: "active",
      started_at: now,
      last_message_at: now,
      last_inbound_at: null,
      metadata: { chat_kind: "group" },
    })
    .select("id")
    .single();

  if (error || !created) {
    throw new Error(`Failed to create group conversation: ${error?.message}`);
  }
  return { id: created.id as string, is_new: true };
}

/**
 * WhatsApp increasingly addresses 1:1 chats by an anonymized `@lid` instead of
 * the phone jid, and a reply typed in the phone app often carries nothing else
 * — no phone number anywhere on the message. So the first time a chat's lid
 * arrives alongside a resolvable phone, pin it to the conversation; lid-only
 * messages are then matched back through it instead of being dropped.
 */
export async function rememberChatLid(
  conversationId: string,
  chatLid: string
): Promise<void> {
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("conversations")
    .select("metadata")
    .eq("id", conversationId)
    .maybeSingle();
  const metadata = (data?.metadata as Record<string, unknown>) ?? {};
  if (metadata.wa_lid === chatLid) return;
  await admin
    .from("conversations")
    .update({ metadata: { ...metadata, wa_lid: chatLid } })
    .eq("id", conversationId);
}

/**
 * The conversation for a phone, without creating one. Presence arrives for
 * chats that may never have written to us — a typing indicator is no reason to
 * conjure an empty thread.
 */
export async function findConversationByPhone(
  customerPhone: string
): Promise<{ id: string } | null> {
  const canonical = canonicalPhone(customerPhone);
  if (!canonical) return null;
  const { data } = await getAdminSupabaseClient()
    .from("conversations")
    .select("id")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .eq("customer_phone", canonical)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ? { id: data.id as string } : null;
}

/** The conversation a lid-only message belongs to, if we've seen the lid. */
export async function findConversationByLid(
  chatLid: string
): Promise<{ id: string } | null> {
  const { data } = await getAdminSupabaseClient()
    .from("conversations")
    .select("id")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .eq("metadata->>wa_lid", chatLid)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ? { id: data.id as string } : null;
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
