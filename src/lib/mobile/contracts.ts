import type {
  BookingStage,
  Conversation,
  CsStatus,
  DriverOrderRow,
  Label,
} from "@/lib/types";
import type { FieldStaffSession } from "@/lib/field-staff";

export const MOBILE_API_VERSION = 1 as const;
export const MOBILE_DANGER_AFTER_SECONDS = 6 * 60;
export const MOBILE_CONVERSATION_VIEWS = [
  "today",
  "new",
  "mine",
  "unassigned",
  "specialists",
  "drivers",
  "groups",
  "danger",
] as const;

export type MobileConversationView =
  (typeof MOBILE_CONVERSATION_VIEWS)[number];

export interface MobileSession {
  userId: string;
  email: string | null;
  role: "admin" | "agent" | "specialist" | "driver";
  isOwner: boolean;
  teamMemberId: string | null;
  fieldStaffAccountId: string | null;
  rosterId: string | null;
  displayName: string | null;
  nationality: string | null;
  preferredLanguage: string | null;
}

/**
 * The last line of a thread, for the list row.
 *
 * The text is whatever was said; media carries no text, so the row draws its
 * own label from `messageType`. Absent on a thread whose newest message could
 * not be read — the row falls back to the number rather than guessing.
 */
export interface MobileConversationPreview {
  at: string;
  role: "customer" | "agent" | "system";
  messageType: string;
  text: string;
  deliveryStatus: string | null;
  /** Who spoke, in a group thread. Null on a 1:1 chat, where it is the customer. */
  participantName?: string | null;
}

export interface MobileConversation
  extends Omit<Conversation, "restaurant_id" | "metadata"> {
  csStatus: CsStatus;
  /** Somebody answered this from the phone's WhatsApp app, not from here. */
  handledOnWhatsApp: boolean;
  /** A WhatsApp group rather than a person — listed in its own tab. */
  isGroup: boolean;
  bookingStage: BookingStage | null;
  dangerMinutes: number | null;
  /** Every label currently assigned to the conversation, for inbox chips. */
  labels: Label[];
  lastMessage?: MobileConversationPreview | null;
}

export type MobileOrder = DriverOrderRow;

export interface MobilePage<T> {
  items: T[];
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
  nextOffset: number | null;
}

export interface MobileApiError {
  error: {
    code: string;
    message: string;
  };
}

export function toMobileSession(session: {
  userId: string;
  email: string | null;
  role: "admin" | "agent";
  isOwner: boolean;
  teamMemberId: string | null;
}): MobileSession {
  return {
    userId: session.userId,
    email: session.email,
    role: session.role,
    isOwner: session.isOwner,
    teamMemberId: session.teamMemberId,
    fieldStaffAccountId: null,
    rosterId: null,
    displayName: null,
    nationality: null,
    preferredLanguage: null,
  };
}

export function fieldStaffToMobileSession(session: FieldStaffSession): MobileSession {
  return {
    userId: session.userId,
    email: null,
    role: session.role,
    isOwner: false,
    teamMemberId: null,
    fieldStaffAccountId: session.accountId,
    rosterId: session.rosterId,
    displayName: session.displayName,
    nationality: session.nationality,
    preferredLanguage: session.preferredLanguage,
  };
}
