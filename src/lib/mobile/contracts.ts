import type {
  BookingStage,
  Conversation,
  CsStatus,
  DriverOrderRow,
} from "@/lib/types";

export const MOBILE_API_VERSION = 1 as const;
export const MOBILE_DANGER_AFTER_SECONDS = 6 * 60;
export const MOBILE_CONVERSATION_VIEWS = [
  "new",
  "unassigned",
  "danger",
] as const;

export type MobileConversationView =
  (typeof MOBILE_CONVERSATION_VIEWS)[number];

export interface MobileSession {
  userId: string;
  email: string | null;
  role: "admin" | "agent";
  teamMemberId: string | null;
}

export interface MobileConversation
  extends Omit<Conversation, "restaurant_id"> {
  csStatus: CsStatus;
  bookingStage: BookingStage | null;
  dangerMinutes: number | null;
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
  teamMemberId: string | null;
}): MobileSession {
  return {
    userId: session.userId,
    email: session.email,
    role: session.role,
    teamMemberId: session.teamMemberId,
  };
}
