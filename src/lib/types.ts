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
}

/** A delivery driver (السائق) the order is dispatched to over WhatsApp. */
export interface Driver {
  id: string;
  full_name: string;
  phone: string; // E.164
  is_active: boolean;
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
