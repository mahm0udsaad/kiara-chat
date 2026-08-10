import { bookingStageOf } from "@/lib/booking-stage";
import { listConversations } from "@/lib/inbox";
import {
  MOBILE_DANGER_AFTER_SECONDS,
  type MobileConversation,
  type MobileConversationView,
  type MobilePage,
} from "@/lib/mobile/contracts";
import { phoneMatches } from "@/lib/phone";
import type { Conversation, CsStatus } from "@/lib/types";

const MAX_MOBILE_CONVERSATION_SCAN = 500;

export function conversationCsStatus(
  conversation: Pick<Conversation, "metadata" | "status">
): CsStatus {
  const configured = (
    conversation.metadata as { cs_status?: unknown } | null
  )?.cs_status;
  if (
    configured === "open" ||
    configured === "waiting" ||
    configured === "resolved"
  ) {
    return configured;
  }
  return conversation.status === "resolved" ? "resolved" : "open";
}

/**
 * Mirrors the web inbox danger rule: the latest inbound is still the latest
 * conversation activity, it is unresolved, and at least six minutes passed.
 */
export function conversationDangerMinutes(
  conversation: Pick<
    Conversation,
    "last_inbound_at" | "last_message_at" | "metadata" | "status"
  >,
  now = Date.now()
): number | null {
  if (
    !conversation.last_inbound_at ||
    conversationCsStatus(conversation) === "resolved"
  ) {
    return null;
  }

  const inboundAt = Date.parse(conversation.last_inbound_at);
  const latestActivityAt = Date.parse(conversation.last_message_at);
  if (!Number.isFinite(inboundAt) || !Number.isFinite(latestActivityAt)) {
    return null;
  }

  // Ingest updates the message and conversation in separate writes. A small
  // tolerance prevents that write latency from looking like an agent reply.
  if (latestActivityAt > inboundAt + 2_000) return null;

  const elapsedSeconds = Math.floor((now - inboundAt) / 1_000);
  if (elapsedSeconds < MOBILE_DANGER_AFTER_SECONDS) return null;
  return Math.max(6, Math.floor(elapsedSeconds / 60));
}

export function toMobileConversation(
  conversation: Conversation,
  now = Date.now()
): MobileConversation {
  return {
    id: conversation.id,
    customer_phone: conversation.customer_phone,
    customer_name: conversation.customer_name ?? null,
    status: conversation.status,
    started_at: conversation.started_at,
    last_message_at: conversation.last_message_at,
    last_inbound_at: conversation.last_inbound_at ?? null,
    handler_mode: conversation.handler_mode,
    assigned_to: conversation.assigned_to ?? null,
    unread_count: conversation.unread_count ?? 0,
    metadata: conversation.metadata ?? null,
    csStatus: conversationCsStatus(conversation),
    bookingStage: bookingStageOf(conversation),
    dangerMinutes: conversationDangerMinutes(conversation, now),
  };
}

function matchesSearch(conversation: Conversation, rawQuery: string): boolean {
  const query = rawQuery.trim().toLocaleLowerCase("ar");
  if (!query) return true;
  return (
    (conversation.customer_name ?? "").toLocaleLowerCase("ar").includes(query) ||
    conversation.customer_phone.toLocaleLowerCase("ar").includes(query) ||
    phoneMatches(conversation.customer_phone, query)
  );
}

function matchesView(
  conversation: Conversation,
  view: MobileConversationView,
  now: number
): boolean {
  if (view === "new") return (conversation.unread_count ?? 0) > 0;
  if (view === "unassigned") return !conversation.assigned_to;
  return conversationDangerMinutes(conversation, now) !== null;
}

export async function listMobileConversations(options: {
  isAdmin: boolean;
  teamMemberId: string | null;
  view: MobileConversationView;
  search: string;
  offset: number;
  limit: number;
}): Promise<{
  page: MobilePage<MobileConversation>;
  counts: Record<MobileConversationView, number>;
}> {
  const now = Date.now();
  const conversations = await listConversations(
    MAX_MOBILE_CONVERSATION_SCAN,
    {
      isAdmin: options.isAdmin,
      teamMemberId: options.teamMemberId,
    }
  );
  const searched = conversations.filter((conversation) =>
    matchesSearch(conversation, options.search)
  );
  const counts = {
    new: searched.filter((conversation) =>
      matchesView(conversation, "new", now)
    ).length,
    unassigned: searched.filter((conversation) =>
      matchesView(conversation, "unassigned", now)
    ).length,
    danger: searched.filter((conversation) =>
      matchesView(conversation, "danger", now)
    ).length,
  };
  const matching = searched.filter((conversation) =>
    matchesView(conversation, options.view, now)
  );
  const items = matching
    .slice(options.offset, options.offset + options.limit)
    .map((conversation) => toMobileConversation(conversation, now));
  const nextOffset = options.offset + items.length;

  return {
    page: {
      items,
      offset: options.offset,
      limit: options.limit,
      total: matching.length,
      hasMore: nextOffset < matching.length,
      nextOffset: nextOffset < matching.length ? nextOffset : null,
    },
    counts,
  };
}
