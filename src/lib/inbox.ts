import { createServerSupabaseClient } from "@/lib/supabase/server";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import { canViewConversation } from "@/lib/conversation-meta";
import type { Conversation, Message } from "@/lib/types";

/** Who is asking — decides whether exclusively-routed chats are visible. */
export interface ConversationViewer {
  isAdmin: boolean;
  teamMemberId: string | null;
}

const CONVERSATION_COLS =
  "id, restaurant_id, customer_phone, customer_name, status, started_at, last_message_at, last_inbound_at, handler_mode, assigned_to, unread_count, metadata";

const MESSAGE_COLS =
  "id, conversation_id, role, content, message_type, metadata, external_message_sid, delivery_status, twilio_status, created_at";

/**
 * List Kiara's conversations, newest activity first. RLS + explicit pin.
 *
 * A chat the owner routed to one employee is dropped for everyone else, which
 * is also what silences it for them: the unread badge only ever comes from a
 * row in this list. The filter runs in app code rather than SQL because the
 * flag lives inside the metadata JSON — the over-fetch is bounded by `limit`.
 */
export async function listConversations(
  limit = 200,
  viewer: ConversationViewer = { isAdmin: true, teamMemberId: null }
): Promise<Conversation[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("conversations")
    .select(CONVERSATION_COLS)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .order("last_message_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Conversation[]).filter((c) =>
    canViewConversation(c, viewer)
  );
}

/**
 * Every visible conversation, read in bounded database pages.
 *
 * Mobile search and its tab counts must describe the whole inbox. A single
 * `.limit(500)` silently made older customers impossible to find, so the full
 * classification path walks the ordered result set in predictable batches.
 */
export async function listAllConversations(
  viewer: ConversationViewer = { isAdmin: true, teamMemberId: null },
  batchSize = 1_000,
): Promise<Conversation[]> {
  const supabase = await createServerSupabaseClient();
  const visible: Conversation[] = [];
  for (let offset = 0; ; offset += batchSize) {
    const { data, error } = await supabase
      .from("conversations")
      .select(CONVERSATION_COLS)
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .order("last_message_at", { ascending: false })
      .range(offset, offset + batchSize - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Conversation[];
    visible.push(...rows.filter((conversation) => canViewConversation(conversation, viewer)));
    if (rows.length < batchSize) break;
  }
  return visible;
}

/**
 * One conversation by id, or null if it isn't there — or isn't ours to see.
 *
 * `listConversations` returns only the most recently active threads, so a
 * deep link from /orders can point at a customer who booked months ago and has
 * dropped off the end of that list. This fetches the one row it needs, with the
 * same visibility rule applied.
 */
export async function getConversationById(
  id: string,
  viewer: ConversationViewer = { isAdmin: true, teamMemberId: null }
): Promise<Conversation | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("conversations")
    .select(CONVERSATION_COLS)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  const conversation = data as Conversation;
  return canViewConversation(conversation, viewer) ? conversation : null;
}

/** Messages a freshly opened thread starts with; older ones page in on scroll. */
export const MESSAGE_PAGE_SIZE = 8;
/** How many older messages one scroll-up pulls — fewer round trips than 8. */
export const OLDER_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export interface MessagePage {
  /** Oldest first, ready to render. */
  messages: Message[];
  /** Whether anything older than the first row is still unread from the DB. */
  hasMore: boolean;
}

/**
 * One page of a conversation's messages, newest page first.
 *
 * A year-old thread is thousands of rows and none of them matter on open, so
 * the query walks backwards from the newest and the client asks for more as it
 * scrolls up. `before` is the `created_at` of the oldest row already on screen;
 * the bound is inclusive so a message sharing that exact timestamp can't fall
 * through the gap — the client drops the duplicate by id.
 *
 * Confirms the conversation belongs to Kiara before reading; RLS enforces this
 * too.
 */
export async function getConversationMessages(
  conversationId: string,
  opts: { limit?: number; before?: string | null } = {}
): Promise<MessagePage> {
  const supabase = await createServerSupabaseClient();

  const { data: conv } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  if (!conv) return { messages: [], hasMore: false };

  const limit = Math.min(Math.max(opts.limit ?? MESSAGE_PAGE_SIZE, 1), MAX_PAGE_SIZE);

  let query = supabase
    .from("messages")
    .select(MESSAGE_COLS)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    // One extra row is the cheapest way to know whether a page follows.
    .limit(limit + 1);
  if (opts.before) query = query.lte("created_at", opts.before);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Message[];
  const hasMore = rows.length > limit;
  return { messages: rows.slice(0, limit).reverse(), hasMore };
}
