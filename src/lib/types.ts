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
  /** Code from NATIONALITIES (src/lib/nationalities.ts); drives translation. */
  nationality?: string | null;
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

/**
 * A visit is one leg: the driver drops the specialist off ("one_way" — half a
 * trip) and often doesn't bring her back on the same order. "round_trip" is the
 * full there-and-back. Each is priced separately (see DispatchSettings).
 */
export type TripType = "one_way" | "round_trip";

/** A dispatch order sent to a driver's WhatsApp for one conversation. */
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
