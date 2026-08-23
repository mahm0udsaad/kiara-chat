/**
 * Conversation metadata that drives *who* handles a chat.
 *
 * Two independent owner-only decisions, both stored in `conversations.metadata`
 * (no schema change — the column already carries cs_status/booking_request):
 *
 * - `section`  — which CS desk the chat belongs to (الطلبات / الردود). A label
 *                for filtering; it does NOT restrict anyone.
 * - `routed_to`— an exclusive route to one team member. A routed chat is
 *                invisible to every other employee: it never reaches their
 *                list, so it never shows an unread badge either. Admins always
 *                see everything.
 *
 * Pure helpers only — imported by both the server queries and the client.
 */
import type {
  BookingRequest,
  Conversation,
  ConversationSection,
} from "@/lib/types";

export const SECTION_LABEL: Record<ConversationSection, string> = {
  orders: "قسم الطلبات",
  replies: "قسم الردود",
};

export const SECTION_ORDER: ConversationSection[] = ["orders", "replies"];

export function isConversationSection(v: unknown): v is ConversationSection {
  return v === "orders" || v === "replies";
}

type RoutingMeta = {
  section?: unknown;
  routed_to?: unknown;
};

const metaOf = (c: Pick<Conversation, "metadata">): RoutingMeta =>
  (c.metadata as RoutingMeta | null) ?? {};

export function sectionOf(
  c: Pick<Conversation, "metadata">
): ConversationSection | null {
  const s = metaOf(c).section;
  return isConversationSection(s) ? s : null;
}

/** The team member this chat is routed to exclusively, if any. */
export function routedToOf(c: Pick<Conversation, "metadata">): string | null {
  const r = metaOf(c).routed_to;
  return typeof r === "string" && r ? r : null;
}

/**
 * The single visibility rule, shared by the list query and the per-conversation
 * API guard so they can never disagree.
 */
export function canViewConversation(
  c: Pick<Conversation, "metadata">,
  viewer: { isAdmin: boolean; teamMemberId: string | null }
): boolean {
  if (viewer.isAdmin) return true;
  const routedTo = routedToOf(c);
  return !routedTo || routedTo === viewer.teamMemberId;
}

/**
 * The bot-collected booking details still waiting on a human, if any.
 *
 * Lives in the same `conversations.metadata` blob as the routing keys above.
 * Both clients read it — the web inbox banner and the mobile chat header —
 * so the shape check belongs here rather than in either component.
 */
export function bookingRequestOf(
  c: Pick<Conversation, "metadata">
): BookingRequest | null {
  const request = (c.metadata as { booking_request?: BookingRequest } | null)
    ?.booking_request;
  return request && request.status === "pending" ? request : null;
}
