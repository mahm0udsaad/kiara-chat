// Shared shapes, aligned with the whatsapp-cs database (see the parent app's
// src/lib/types.ts). Only what Kiara Chat needs.

export type ConversationHandlerMode = "unassigned" | "human" | "bot";
// DB CHECK allows exactly these; Kiara's UI status lives in metadata.cs_status.
export type ConversationStatus = "active" | "resolved" | "escalated";

export interface Conversation {
  id: string;
  restaurant_id: string;
  customer_phone: string;
  customer_name?: string | null;
  status: ConversationStatus;
  started_at: string;
  last_message_at: string;
  last_inbound_at?: string | null;
  handler_mode?: ConversationHandlerMode;
  assigned_to?: string | null;
  unread_count?: number | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * How a thread has been dealt with — the axis the inbox's tabs don't cover.
 * `read_unclaimed` is read by someone but assigned to nobody.
 */
export type ConversationHandling = "whatsapp" | "unread" | "read_unclaimed";

export const CONVERSATION_HANDLINGS: readonly ConversationHandling[] = [
  "whatsapp",
  "unread",
  "read_unclaimed",
];

export function isConversationHandling(
  value: string
): value is ConversationHandling {
  return (CONVERSATION_HANDLINGS as readonly string[]).includes(value);
}

export interface Message {
  id: string;
  conversation_id: string;
  role: "customer" | "agent" | "system";
  content: string;
  message_type: string;
  metadata?: Record<string, unknown> | null;
  external_message_sid?: string | null;
  delivery_status?: string | null;
  twilio_status?: string | null;
  created_at: string;
}

export type LabelColor =
  | "slate"
  | "red"
  | "amber"
  | "emerald"
  | "blue"
  | "indigo"
  | "fuchsia"
  | "rose";

export interface Label {
  id: string;
  name: string;
  color: LabelColor;
}

export type CsStatus = "open" | "waiting" | "resolved";

/** The operational booking stage tracked on a customer conversation. */
export type BookingStage =
  | "collecting_details"
  | "awaiting_confirmation"
  | "booking_confirmed"
  | "invoice_required"
  | "in_progress"
  | "completed";

/**
 * Which customer-service desk owns a chat. Set by the owner per conversation —
 * employees are not tagged with a section anywhere, so this lives on the
 * conversation alone (see lib/conversation-meta.ts).
 */
export type ConversationSection = "orders" | "replies";

export interface AgentInfo {
  id: string; // team_members.id
  role: string;
  email: string | null;
  /** team_members.full_name — shown on conversation rows instead of the email. */
  fullName: string | null;
  isActive?: boolean;
}

/** A salon specialist (الأخصائية) — the person who visits the customer. */
export interface Specialist {
  id: string;
  full_name: string;
  phone: string | null;
  is_active: boolean;
  /** Code from NATIONALITIES; supplies the default language. */
  nationality?: string | null;
  /** Explicit app/dispatch language override; null derives from nationality. */
  preferred_language?: string | null;
}

/** A delivery driver (السائق) the order is dispatched to over WhatsApp. */
export interface Driver {
  id: string;
  full_name: string;
  phone: string; // E.164
  is_active: boolean;
}

/**
 * Booking details the bot collected before handing the chat to staff. Lives in
 * conversations.metadata.booking_request (no schema change on the shared DB).
 * The bot only ever records it — a human picks specialist/driver and creates
 * the actual order, which clears it.
 */
export interface BookingRequest {
  status: "pending";
  summary: string;
  service: string;
  time: string;
  location: string;
  at: string; // ISO — when the bot captured it
}

export type DriverOrderStatus = "pending" | "sent" | "failed";

export interface FieldSessionState {
  started_at: string | null;
  completed_at: string | null;
}

/**
 * The in-app field workflow's step machine for one order, as stored in
 * `field_order_progress`.
 *
 * Distinct from {@link FieldSessionState}, which is the older two-timestamp
 * mirror kept on the conversation for the magic-link flow. This is the real
 * chain the driver and specialist advance through in the app:
 *   confirm_ride → confirm_pickup → start_service → complete_order →
 *   driver_return, with driver_arrived sitting beside it as a side event.
 */
export interface FieldOrderProgressState {
  driverConfirmedAt: string | null;
  driverArrivedAt: string | null;
  specialistPickupAt: string | null;
  serviceStartedAt: string | null;
  completedAt: string | null;
  driverReturnedAt: string | null;
  lastActivityAt: string;
  lastReminderAt: string | null;
  version: number;
}

/**
 * How far the driver goes. "round_trip" is the full there-and-back and is what
 * a visit defaults to, because that is the normal shape of the work; "one_way"
 * is the exception, where he drops her off and does not bring her back on this
 * order. Each is priced separately (see DispatchSettings), so the default is
 * also a pricing decision: a round trip bills the full-trip price.
 */
export type TripType = "one_way" | "round_trip";

/** One conversation's dispatch order, carried to the field team's app and
 * copied to their WhatsApp. */
export interface DriverOrder {
  id: string;
  conversation_id: string;
  specialist_id: string | null;
  driver_id: string | null;
  arrival_at: string; // ISO
  customer_location: string;
  customer_phone: string;
  duration_minutes: number;
  trip_type: TripType;
  /** Snapshotted from DispatchSettings at creation; null until prices are set. */
  price: number | null;
  status: DriverOrderStatus;
  sent_at: string | null;
  created_at: string;
  /** Set by the DB on every write; equals created_at until someone edits. */
  updated_at?: string | null;
  /** The team member who last edited the order — null for untouched rows. */
  updated_by?: string | null;
  /** Compare-and-swap version used by every operational mutation. */
  version: number;
  /** Separate from transport status so an in-flight dispatch is visible. */
  dispatch_state: "idle" | "processing" | "sent" | "failed" | "uncertain";
  active_dispatch_command_id?: string | null;
  dispatch_started_at?: string | null;
  /**
   * The Rekaz reservation this order serves, when it was raised from the
   * calendar. Null for orders created from a conversation. Merging the two
   * sides on this id replaces the old phone-plus-day guess.
   */
  rekaz_source_id?: string | null;
  expected_end_at?: string;
  approved_services?: { sourceId: string | null; name: string; minutes: number }[];
  /**
   * What the field team reads in the app. Dispatch composes these; nothing is
   * sent to a driver's or specialist's WhatsApp. Undefined on rows read before
   * the 20260902100000 migration, null on orders never dispatched.
   */
  driver_note?: string | null;
  specialist_note?: string | null;
  /** `whatsapp-media` storage path — signed on read, never handed out raw. */
  specialist_voice_path?: string | null;
  /** Photo of the customer's door, for the driver. Same storage convention. */
  door_photo_path?: string | null;
}

/**
 * An order with the names the orders list needs. The roster/conversation names
 * are resolved in a second small query rather than a PostgREST embed, so the
 * list doesn't depend on the shape of the out-of-band FKs.
 */
export interface DriverOrderRow extends DriverOrder {
  specialist_name: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  customer_name: string | null;
  /** Who last edited it, for the "عُدّل بواسطة …" line. */
  updated_by_name: string | null;
  specialist_session?: FieldSessionState;
  driver_session?: FieldSessionState;
  /**
   * Where the visit actually stands in the app's step machine. Null when the
   * order was never dispatched (no progress row) or the table is not readable
   * — the orders screen renders either way.
   */
  field_progress?: FieldOrderProgressState | null;
}

/** Per-tenant dispatch pricing. Owner/manager-only (RLS blocks agents). */
export interface DispatchSettings {
  fullTripPrice: number; // ذهاب وعودة
  halfTripPrice: number; // ذهاب فقط
}

export interface MediaSlot {
  storage_path: string | null;
  content_type: string;
  size_bytes: number | null;
  original_filename?: string | null;
  delivery_status?: string;
  caption?: string | null;
}
