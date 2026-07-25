import { createServerSupabaseClient } from "@/lib/supabase/server";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import type { Conversation, Message } from "@/lib/types";

const CONVERSATION_COLS =
  "id, restaurant_id, customer_phone, customer_name, status, started_at, last_message_at, last_inbound_at, handler_mode, assigned_to, unread_count, metadata";

const MESSAGE_COLS =
  "id, conversation_id, role, content, message_type, metadata, external_message_sid, delivery_status, twilio_status, created_at";

/** List Kiara's conversations, newest activity first. RLS + explicit pin. */
export async function listConversations(limit = 200): Promise<Conversation[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("conversations")
    .select(CONVERSATION_COLS)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .order("last_message_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as Conversation[];
}

/**
 * Load a conversation's messages (oldest first). Confirms the conversation
 * belongs to Kiara before reading; RLS enforces this too.
 */
export async function getConversationMessages(
  conversationId: string
): Promise<Message[]> {
  const supabase = await createServerSupabaseClient();

  const { data: conv } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  if (!conv) return [];

  const { data, error } = await supabase
    .from("messages")
    .select(MESSAGE_COLS)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as Message[];
}
