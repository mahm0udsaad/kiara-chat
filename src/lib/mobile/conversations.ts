import { bookingStageOf } from "@/lib/booking-stage";
import { isGroupConversation, sectionOf } from "@/lib/conversation-meta";
import {
  getConversationLabelIds,
  getLabelAssignments,
  listLabels,
} from "@/lib/labels";
import { listDrivers, listSpecialists } from "@/lib/dispatch";
import { listAllConversations } from "@/lib/inbox";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  MOBILE_DANGER_AFTER_SECONDS,
  type MobileConversation,
  type MobileConversationPreview,
  type MobileConversationView,
  type MobilePage,
} from "@/lib/mobile/contracts";
import { canonicalPhone, normalizePhone, phoneMatches } from "@/lib/phone";
import { specialistConversationIdsFromLabels } from "@/lib/specialist-conversations";
import type {
  BookingStage,
  Conversation,
  ConversationHandling,
  ConversationSection,
  CsStatus,
} from "@/lib/types";

const EMPTY_PHONE_SET: ReadonlySet<string> = new Set();
const EMPTY_CONVERSATION_ID_SET: ReadonlySet<string> = new Set();

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

// Re-exported so existing importers of this module keep working; the
// predicate itself now lives with the other metadata readers.
export { isGroupConversation };

/**
 * True once someone answered this thread from the WhatsApp app on the phone
 * rather than from here. Set by the ingest webhook on every `fromMe` message
 * our own send path did not produce.
 */
export function isHandledOnWhatsApp(
  conversation: Pick<Conversation, "metadata">
): boolean {
  return Boolean(
    (conversation.metadata as { handled_on_whatsapp?: unknown } | null)
      ?.handled_on_whatsapp
  );
}

/**
 * Mirrors the web inbox danger rule: the latest inbound is still the latest
 * conversation activity, it is unresolved, and at least six minutes passed.
 */
export function conversationDangerMinutes(
  conversation: Pick<
    Conversation,
    | "customer_phone"
    | "id"
    | "last_inbound_at"
    | "last_message_at"
    | "metadata"
    | "status"
  >,
  now = Date.now(),
  dangerExcludedPhoneSet: ReadonlySet<string> = EMPTY_PHONE_SET,
  dangerExcludedConversationIds: ReadonlySet<string> = EMPTY_CONVERSATION_ID_SET,
): number | null {
  if (
    dangerExcludedPhoneSet.has(normalizePhone(conversation.customer_phone)) ||
    dangerExcludedConversationIds.has(conversation.id)
  ) {
    return null;
  }
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
  now = Date.now(),
  dangerExcludedPhoneSet: ReadonlySet<string> = EMPTY_PHONE_SET,
  dangerExcludedConversationIds: ReadonlySet<string> = EMPTY_CONVERSATION_ID_SET,
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
    csStatus: conversationCsStatus(conversation),
    handledOnWhatsApp: isHandledOnWhatsApp(conversation),
    isGroup: isGroupConversation(conversation),
    bookingStage: bookingStageOf(conversation),
    dangerMinutes: conversationDangerMinutes(
      conversation,
      now,
      dangerExcludedPhoneSet,
      dangerExcludedConversationIds,
    ),
    // Classification attaches the assigned labels at the list/detail boundary.
    labels: [],
  };
}

function matchesSearch(conversation: Conversation, rawQuery: string): boolean {
  const query = rawQuery.trim().toLocaleLowerCase("ar");
  if (!query) return true;
  if (isGroupConversation(conversation)) {
    // Its "phone" is a jid — matching digits against it would surface a group
    // for any number that happens to share a run of digits with the jid.
    return (conversation.customer_name ?? "")
      .toLocaleLowerCase("ar")
      .includes(query);
  }
  return (
    (conversation.customer_name ?? "").toLocaleLowerCase("ar").includes(query) ||
    conversation.customer_phone.toLocaleLowerCase("ar").includes(query) ||
    phoneMatches(conversation.customer_phone, query)
  );
}

function matchesView(
  conversation: Conversation,
  view: MobileConversationView,
  now: number,
  dangerExcludedPhoneSet: ReadonlySet<string>,
  specialistPhoneSet: ReadonlySet<string>,
  specialistConversationIdSet: ReadonlySet<string>,
  teamMemberId: string | null,
  driverPhoneSet: ReadonlySet<string> = EMPTY_PHONE_SET,
): boolean {
  // Groups are their own room. They are checked before anything else because
  // a group's jid is not a phone, so every phone-keyed rule below would be
  // answering a question that doesn't apply to it.
  const isGroup = isGroupConversation(conversation);
  if (view === "groups") return isGroup;
  if (isGroup) return false;
  const isSpecialist =
    specialistPhoneSet.has(normalizePhone(conversation.customer_phone)) ||
    specialistConversationIdSet.has(conversation.id);
  if (view === "specialists") return isSpecialist;
  // Specialist threads live in one dedicated place. Keeping this guard in
  // the shared matcher means they cannot leak into a normal tab or its count.
  if (isSpecialist) return false;
  // Drivers get the same treatment for the same reason: the salon works its
  // customer queue in the other tabs, and a driver saying "وصلت" is not a
  // customer waiting on an answer.
  const isDriver = driverPhoneSet.has(normalizePhone(conversation.customer_phone));
  if (view === "drivers") return isDriver;
  if (isDriver) return false;
  if (view === "new") return (conversation.unread_count ?? 0) > 0;
  if (view === "mine") {
    return Boolean(
      teamMemberId && conversation.assigned_to === teamMemberId
    );
  }
  if (view === "unassigned") return !conversation.assigned_to;
  return (
    conversationDangerMinutes(
      conversation,
      now,
      dangerExcludedPhoneSet,
      specialistConversationIdSet,
    ) !== null
  );
}

async function loadMobileConversationClassification(conversationId?: string) {
  const [specialists, drivers, labels, labelAssignments] = await Promise.all([
    listSpecialists(),
    listDrivers(),
    listLabels(),
    conversationId
      ? getConversationLabelIds(conversationId).then((labelIds) => ({
          [conversationId]: labelIds,
        }))
      : getLabelAssignments(),
  ]);
  return {
    labelAssignments,
    specialistPhoneSet: new Set(
      specialists
        .map((specialist) => normalizePhone(specialist.phone ?? ""))
        .filter(Boolean),
    ),
    driverPhoneSet: new Set(
      drivers.map((driver) => normalizePhone(driver.phone ?? "")).filter(Boolean),
    ),
    dangerExcludedPhoneSet: new Set(
      [...specialists, ...drivers]
        .map((person) => normalizePhone(person.phone ?? ""))
        .filter(Boolean),
    ),
    specialistConversationIdSet: specialistConversationIdsFromLabels(
      labels,
      labelAssignments,
    ),
    labels,
  };
}

/**
 * The newest message in each conversation on this page, for the list preview.
 *
 * Bounded by the page's own oldest activity: every conversation's newest
 * message is by definition at or after its `last_message_at`, so nothing older
 * than the oldest row on the page can be the answer for any of them. That
 * keeps one query in place of fifty — which matters more here than it looks,
 * with the functions and the database on different continents.
 *
 * A failure returns no previews rather than failing the inbox: a row without
 * its last line still opens the chat.
 */
async function lastMessagesFor(
  conversations: Conversation[],
): Promise<Map<string, MobileConversationPreview>> {
  const out = new Map<string, MobileConversationPreview>();
  if (!conversations.length) return out;

  const ids = conversations.map((conversation) => conversation.id);
  const oldest = conversations
    .map((conversation) => conversation.last_message_at)
    .filter(Boolean)
    .sort()[0];

  const admin = getAdminSupabaseClient();
  let query = admin
    .from("messages")
    .select(
      "conversation_id, role, content, message_type, delivery_status, created_at, metadata",
    )
    .in("conversation_id", ids)
    .order("created_at", { ascending: false })
    // A ceiling on a pathological day; the window above is the real bound.
    .limit(2_000);
  if (oldest) query = query.gte("created_at", oldest);

  const { data, error } = await query;
  if (error) {
    console.error("[mobile-inbox] last-message previews unavailable", error);
    return out;
  }

  // Newest first, so the first row seen for a conversation is its latest.
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const conversationId = String(row.conversation_id);
    if (out.has(conversationId)) continue;
    out.set(conversationId, {
      at: String(row.created_at),
      role: (row.role as MobileConversationPreview["role"]) ?? "customer",
      messageType: String(row.message_type ?? "text"),
      text: String(row.content ?? "").replace(/\s+/g, " ").trim().slice(0, 160),
      deliveryStatus: (row.delivery_status as string | null) ?? null,
      participantName:
        ((row.metadata as { participant_name?: unknown } | null)
          ?.participant_name as string | undefined) ?? null,
    });
  }
  return out;
}

/** One correctly classified row for detail and mutation responses. */
export async function toClassifiedMobileConversation(
  conversation: Conversation,
): Promise<MobileConversation> {
  const classification = await loadMobileConversationClassification(
    conversation.id,
  );
  const assigned = new Set(classification.labelAssignments[conversation.id] ?? []);
  return {
    ...toMobileConversation(
      conversation,
      Date.now(),
      classification.dangerExcludedPhoneSet,
      classification.specialistConversationIdSet,
    ),
    labels: classification.labels.filter((label) => assigned.has(label.id)),
  };
}

/**
 * The refinements that sit beside the inbox views, mirroring the web inbox's
 * three dropdowns. They narrow whichever view is open rather than replacing
 * it, and they apply before the view counts are taken — so a tab's number is
 * exactly how many rows tapping it would show under the current filter, and
 * never promises results the filter has already excluded.
 */
export interface MobileConversationFilters {
  status: CsStatus | null;
  section: ConversationSection | null;
  labelId: string | null;
  /** Where the booking itself stands — the stage the thread is filed under. */
  bookingStage: BookingStage | null;
  /** How the thread has been dealt with so far — see `matchesHandling`. */
  handling: ConversationHandling | null;
}

const NO_FILTERS: MobileConversationFilters = {
  status: null,
  section: null,
  labelId: null,
  bookingStage: null,
  handling: null,
};

/**
 * Who has actually dealt with the thread, as opposed to what state it is
 * filed under. The three cases the salon asks about by name:
 *
 * - `whatsapp`: answered from the phone's WhatsApp app, so the reply exists
 *   but nothing here records who sent it.
 * - `unread`: nobody has opened it yet.
 * - `read_unclaimed`: somebody opened it and then left it — read, but still
 *   nobody's job. These are the ones that fall through the cracks, and until
 *   now no view separated them from the unread pile.
 */
function matchesHandling(
  conversation: Conversation,
  handling: ConversationHandling
): boolean {
  if (handling === "whatsapp") return isHandledOnWhatsApp(conversation);
  const unread = conversation.unread_count ?? 0;
  if (handling === "unread") return unread > 0;
  return unread === 0 && !conversation.assigned_to;
}

export async function listMobileConversations(options: {
  isAdmin: boolean;
  teamMemberId: string | null;
  view: MobileConversationView;
  search: string;
  offset: number;
  limit: number;
  filters?: MobileConversationFilters;
}): Promise<{
  page: MobilePage<MobileConversation>;
  counts: Record<MobileConversationView, number>;
  /**
   * Exact phone hit before the active inbox tab and advanced filters are
   * applied. Search must not call an existing customer "a new number" merely
   * because her thread lives under another employee's tab.
   */
  exactPhoneMatch: {
    id: string;
    customerName: string | null;
    customerPhone: string;
  } | null;
}> {
  const now = Date.now();
  const filters = options.filters ?? NO_FILTERS;
  const [conversations, classification] = await Promise.all([
    listAllConversations({
      isAdmin: options.isAdmin,
      teamMemberId: options.teamMemberId,
    }),
    loadMobileConversationClassification(),
  ]);
  const {
    dangerExcludedPhoneSet,
    labelAssignments,
    labels,
    driverPhoneSet,
    specialistConversationIdSet,
    specialistPhoneSet,
  } = classification;
  const searchedCanonical = canonicalPhone(options.search);
  const exactPhoneConversation = searchedCanonical
    ? conversations.find(
        (conversation) =>
          canonicalPhone(conversation.customer_phone) === searchedCanonical,
      )
    : null;
  const searched = conversations
    .filter((conversation) => matchesSearch(conversation, options.search))
    .filter((conversation) => {
      if (filters.status && conversationCsStatus(conversation) !== filters.status) {
        return false;
      }
      if (filters.section && sectionOf(conversation) !== filters.section) {
        return false;
      }
      if (
        filters.labelId &&
        !(labelAssignments[conversation.id] ?? []).includes(filters.labelId)
      ) {
        return false;
      }
      if (filters.bookingStage && bookingStageOf(conversation) !== filters.bookingStage) {
        return false;
      }
      if (filters.handling && !matchesHandling(conversation, filters.handling)) {
        return false;
      }
      return true;
    });
  // One shape for every tab: the matcher takes the same classification each
  // time, and six copies of that argument list is how a new tab gets added to
  // five of them.
  const inView = (view: MobileConversationView) =>
    searched.filter((conversation) =>
      matchesView(
        conversation,
        view,
        now,
        dangerExcludedPhoneSet,
        specialistPhoneSet,
        specialistConversationIdSet,
        options.teamMemberId,
        driverPhoneSet,
      ),
    );

  const counts = {
    new: inView("new").length,
    mine: inView("mine").length,
    unassigned: inView("unassigned").length,
    specialists: inView("specialists").length,
    drivers: inView("drivers").length,
    groups: inView("groups").length,
    danger: inView("danger").length,
  };
  // A complete phone search is an address lookup, not a tab browse. Show its
  // exact thread even when it is filed under another view; otherwise search
  // could know the number exists yet leave the employee with a blank screen.
  const matching = exactPhoneConversation
    ? [exactPhoneConversation]
    : inView(options.view);
  const page = matching.slice(options.offset, options.offset + options.limit);
  const previews = await lastMessagesFor(page);
  const items = page.map((conversation) => {
    const assigned = new Set(labelAssignments[conversation.id] ?? []);
    return {
      ...toMobileConversation(
        conversation,
        now,
        dangerExcludedPhoneSet,
        specialistConversationIdSet,
      ),
      labels: labels.filter((label) => assigned.has(label.id)),
      lastMessage: previews.get(conversation.id) ?? null,
    };
  });
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
    exactPhoneMatch: exactPhoneConversation
      ? {
          id: exactPhoneConversation.id,
          customerName: exactPhoneConversation.customer_name ?? null,
          customerPhone: exactPhoneConversation.customer_phone,
        }
      : null,
  };
}
