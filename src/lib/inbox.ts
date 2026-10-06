import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
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

type ReplyReference = {
  message_id?: unknown;
  external_id?: unknown;
  media?: unknown;
};

/**
 * Attach the quoted message's stored media to reply metadata.
 *
 * New Meta replies freeze this at ingest time, but older rows only contain
 * the quoted message id. Resolving a page in one bounded batch makes those
 * existing replies useful too, without one query per bubble.
 */
async function withReplyMedia(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  conversationId: string,
  messages: Message[],
): Promise<Message[]> {
  const internalIds = new Set<string>();
  const externalIds = new Set<string>();

  for (const message of messages) {
    const reply = message.metadata?.reply_to as ReplyReference | undefined;
    if (!reply || (Array.isArray(reply.media) && reply.media.length)) continue;
    if (typeof reply.message_id === "string" && reply.message_id) {
      internalIds.add(reply.message_id);
    } else if (typeof reply.external_id === "string" && reply.external_id) {
      externalIds.add(reply.external_id);
    }
  }

  if (!internalIds.size && !externalIds.size) return messages;

  const lookups = [];
  if (internalIds.size) {
    lookups.push(
      supabase
        .from("messages")
        .select("id, external_message_sid, metadata")
        .eq("conversation_id", conversationId)
        .in("id", [...internalIds]),
    );
  }
  if (externalIds.size) {
    lookups.push(
      supabase
        .from("messages")
        .select("id, external_message_sid, metadata")
        .eq("conversation_id", conversationId)
        .in("external_message_sid", [...externalIds]),
    );
  }

  const results = await Promise.all(lookups);
  const referenced = new Map<string, unknown>();
  for (const result of results) {
    if (result.error) continue;
    for (const row of result.data ?? []) {
      const media = (row.metadata as { media?: unknown } | null)?.media;
      if (!Array.isArray(media) || !media.length) continue;
      referenced.set(String(row.id), media);
      if (row.external_message_sid) {
        referenced.set(String(row.external_message_sid), media);
      }
    }
  }

  return messages.map((message) => {
    const metadata = message.metadata ?? {};
    const reply = metadata.reply_to as ReplyReference | undefined;
    if (!reply || (Array.isArray(reply.media) && reply.media.length)) return message;
    const key =
      typeof reply.message_id === "string" && reply.message_id
        ? reply.message_id
        : typeof reply.external_id === "string"
          ? reply.external_id
          : null;
    const media = key ? referenced.get(key) : null;
    if (!Array.isArray(media) || !media.length) return message;
    return {
      ...message,
      metadata: { ...metadata, reply_to: { ...reply, media } },
    };
  });
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
    .select("id, metadata")
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  if (!conv) return { messages: [], hasMore: false };
  const clearedAt = (conv.metadata as Record<string, unknown> | null)?.clearedAt as
    | string
    | undefined;

  const limit = Math.min(Math.max(opts.limit ?? MESSAGE_PAGE_SIZE, 1), MAX_PAGE_SIZE);

  let query = supabase
    .from("messages")
    .select(MESSAGE_COLS)
    .eq("conversation_id", conversationId)
    // "Deleted" from the thread is per-message and per-conversation, both
    // local to Kiara's view — see `hideMessage`/`clearConversationMessages`.
    .is("metadata->>hiddenAt", null)
    .order("created_at", { ascending: false })
    // One extra row is the cheapest way to know whether a page follows.
    .limit(limit + 1);
  if (opts.before) query = query.lte("created_at", opts.before);
  if (clearedAt) query = query.gt("created_at", clearedAt);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Message[];
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).reverse();
  return {
    messages: await withReplyMedia(supabase, conversationId, page),
    hasMore,
  };
}

/**
 * Hide one message from Kiara's own view of the thread.
 *
 * This cannot and does not reach WhatsApp: the Business Platform has no
 * "delete for everyone" call, so anything already delivered stays on the
 * customer's phone regardless. `content` is left untouched too — the bot's
 * conversation memory, the audit trail, and the quality/analysis reports all
 * read it straight from `messages`, and a staff clean-up action shouldn't
 * quietly rewrite what the owner's report or the AI's context saw. Only the
 * `hiddenAt` marker is new, and only `getConversationMessages` honours it.
 */
export async function hideMessage(
  conversationId: string,
  messageId: string,
  hiddenBy: string | null,
): Promise<boolean> {
  const admin = getAdminSupabaseClient();
  const { data: row } = await admin
    .from("messages")
    .select("id, metadata")
    .eq("id", messageId)
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (!row) return false;

  const meta = (row.metadata as Record<string, unknown> | null) ?? {};
  const { error } = await admin
    .from("messages")
    .update({ metadata: { ...meta, hiddenAt: new Date().toISOString(), hiddenBy } })
    .eq("id", messageId);
  if (error) throw new Error(error.message);
  return true;
}

/**
 * Hide every message currently in the thread from Kiara's own view, by
 * stamping a cutoff on the conversation rather than touching each message row
 * — cheap regardless of how many thousands of messages a long-running thread
 * has. Same "local to Kiara" caveat as `hideMessage`: nothing changes on the
 * customer's phone, and no `content` is touched, so the bot, the audit trail
 * and the reports still see the full history.
 */
export async function clearConversationMessages(conversationId: string): Promise<void> {
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("conversations")
    .select("metadata")
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  const meta = (data?.metadata as Record<string, unknown> | null) ?? {};
  const { error } = await admin
    .from("conversations")
    .update({ metadata: { ...meta, clearedAt: new Date().toISOString() } })
    .eq("id", conversationId);
  if (error) throw new Error(error.message);
}
