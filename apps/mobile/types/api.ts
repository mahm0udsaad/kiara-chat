export type StaffRole = "admin" | "agent" | "specialist" | "driver";

export type OrderStatus = "pending" | "sent" | "failed";

export type TripType = "one_way" | "round_trip";

export type CsStatus = "open" | "waiting" | "resolved";

export type BookingStage =
  | "collecting_details"
  | "awaiting_confirmation"
  | "booking_confirmed"
  | "invoice_required"
  | "in_progress"
  | "completed";

export type BootstrapResponse = {
  apiVersion: 1;
  session: {
    userId: string;
    email: string | null;
    role: StaffRole;
    teamMemberId: string | null;
    fieldStaffAccountId: string | null;
    rosterId: string | null;
    displayName: string | null;
  };
  capabilities: {
    canTakeConversations: boolean;
    canManageTeam: boolean;
    canViewOrderPrices: boolean;
  };
  inbox: {
    dangerAfterSeconds: number;
    views: { id: InboxView; label: string }[];
  };
  agents: { id: string; fullName: string | null; email: string | null }[];
};

export type InboxView = "new" | "mine" | "unassigned" | "danger";

export type ConversationSummary = {
  id: string;
  customer_name: string | null;
  customer_phone: string;
  status: "active" | "resolved" | "escalated";
  started_at: string;
  last_message_at: string;
  last_inbound_at: string | null;
  assigned_to: string | null;
  unread_count: number | null;
  csStatus: CsStatus;
  bookingStage: BookingStage | null;
  dangerMinutes: number | null;
};

export type ConversationMessage = {
  id: string;
  conversation_id: string;
  role: "customer" | "agent" | "system";
  content: string;
  message_type: string;
  created_at: string;
};

export type ConversationDetail = {
  conversation: ConversationSummary & {
    reminderConfirmation: ReminderConfirmation | null;
  };
  messages: ConversationMessage[];
  hasMore: boolean;
  nextBefore: string | null;
};

export type ReminderConfirmationStatus =
  | "not_recorded"
  | "awaiting_reply"
  | "confirmed"
  | "cancelled";

export type ReminderConfirmation = {
  dayKey: string;
  status: ReminderConfirmationStatus;
  remindedAt: string | null;
  updatedAt: string | null;
};

export type OrderSummary = {
  id: string;
  conversation_id: string;
  customer_name: string | null;
  customer_phone: string;
  arrival_at: string;
  customer_location: string;
  duration_minutes: number;
  trip_type: TripType;
  status: OrderStatus;
  specialist_id: string | null;
  driver_id: string | null;
  specialist_name: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  price: number | null;
  sent_at: string | null;
  created_at: string;
  updated_at?: string | null;
  updated_by_name: string | null;
  version: number;
  dispatch_state: "idle" | "processing" | "sent" | "failed" | "uncertain";
  specialist_session?: FieldSessionState;
  driver_session?: FieldSessionState;
  /** Set when the order was raised from a Rekaz visit; the merge key. */
  rekaz_source_id?: string | null;
};

export type CustomerAnalysisResult = {
  satisfaction: {
    score: number;
    label: string;
    summary: string;
  };
  trend: "improving" | "steady" | "declining" | "unknown";
  staff: {
    rating: number;
    strengths: string[];
    issues: string[];
  };
  recommendations: string[];
  redFlags: string[];
  basis: {
    messages: number;
    bookings: number;
    conversationId: string | null;
  };
};

export type RosterOption = {
  id: string;
  full_name: string;
  phone: string | null;
};

export type OrderDetailResponse = {
  order: OrderSummary;
};

export type DispatchOptionsResponse = {
  specialists: RosterOption[];
  drivers: RosterOption[];
};

export type OrderPatch = {
  arrivalAt: string;
  customerLocation: string;
  durationMinutes: number;
  tripType: TripType;
  specialistId: string | null;
  driverId: string | null;
  expectedVersion: number;
};

export type DispatchInput = {
  specialistId: string;
  driverId: string;
  driverMessage: string;
  specialistMessage: string;
  expectedVersion: number;
};

export type DispatchPreview = {
  driverMessage: string;
  specialistMessage: string;
  specialistLanguage: string;
  automaticAdditions: string[];
};

export type MobilePage<T> = {
  items: T[];
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
  nextOffset: number | null;
};

export type ConversationsResponse = {
  view: InboxView;
  query: string;
  counts: Record<InboxView, number>;
  conversations: MobilePage<ConversationSummary>;
};

export type OrdersResponse = { query: string; orders: MobilePage<OrderSummary> };

export type RekazReservation = {
  id: string;
  arrivalAt: string;
  durationMinutes: number;
  service: string;
  quantity: number;
  customerName: string;
  customerPhone: string;
  providers: string[];
  status: string;
  payment: string;
  amount: number;
  location: { lat: number; lng: number; label: string } | null;
  source: string;
  createdBy: string;
  bookedAt: string;
  order: { id: string; status: string; total: number; refunded: number } | null;
  notes: string;
};

export type OrdersCalendarResponse = {
  from: string;
  to: string;
  reservations: RekazReservation[];
  orders: OrderSummary[];
  sync: {
    id: string;
    completedAt: string;
    incoming: number;
    added: number;
    updated: number;
    removed: number;
  } | null;
};

/**
 * The customer record, keyed on normalized phone. There is no `customers`
 * table — a conversation row is the customer — so this is Rekaz's lifetime
 * booking history stitched onto this app's conversation, orders and notes.
 * Mirrors `CustomerTimeline` in src/lib/customer-timeline.ts.
 */
export type TimelineEvent =
  | { kind: "contact"; at: string }
  | {
      kind: "message";
      at: string;
      role: "customer" | "agent" | "system";
      content: string;
      messageType: string;
      hasMedia: boolean;
    }
  | {
      kind: "booking";
      at: string;
      id: string;
      service: string;
      providers: string[];
      status: string;
      payment: string;
      amount: number;
      source: string;
      location: { lat: number; lng: number; label: string } | null;
    }
  | {
      kind: "driver";
      at: string;
      status: string;
      driverName: string | null;
      specialistName: string | null;
      tripType: string;
    }
  | { kind: "note"; at: string; body: string; author: string | null };

export type CustomerTimeline = {
  customer: {
    phone: string;
    name: string | null;
    conversationId: string | null;
    firstContactAt: string | null;
    lastActivityAt: string | null;
    labels: { name: string; color: string }[];
  };
  revenue: {
    net: number;
    booked: number;
    refunded: number;
    orders: number;
    bookings: number;
    cancelled: number;
  };
  events: TimelineEvent[];
  messagesShown: number;
  messagesTotal: number;
  /** True when Rekaz was unreachable — the app half still renders. */
  rekazError: boolean;
};

/** The bounds a Rekaz fetch covered. Absence only means removal inside it. */
export type RekazWindow = { start: string; end: string };

export type RekazSyncCounts = {
  incoming: number;
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
  /** added + updated + removed — what the banner counts as "not pulled yet". */
  pending: number;
};

export type RekazLastSync = {
  id: string;
  completedAt: string | null;
  added: number;
  updated: number;
  removed: number;
} | null;

export type RekazCheckResponse = {
  checkedAt: string;
  window: RekazWindow;
  preview: RekazSyncCounts;
  lastSync: RekazLastSync;
};

export type RekazPullResponse = {
  syncedAt: string;
  window: RekazWindow;
  changes: RekazSyncCounts & { syncRunId: string; replayed: boolean };
  lastSync: RekazLastSync;
};

export type FieldSessionState = {
  started_at: string | null;
  completed_at: string | null;
};

export type FieldSessionVisit = {
  id: string;
  arrivalAt: string;
  durationMinutes: number;
  tripType: TripType;
  customerName: string | null;
  customerPhone: string;
  customerLocation: string;
  specialistName: string | null;
  driverName: string | null;
  state: FieldSessionState;
};

export type FieldSessionRole = "specialist" | "driver";

export type FieldSessionDashboard = {
  role: FieldSessionRole;
  personName: string;
  visits: FieldSessionVisit[];
};

export type FieldOrderAction =
  | "confirm_ride"
  | "confirm_pickup"
  | "start_service"
  | "complete_order";

export type FieldOrderProgress = {
  driverConfirmedAt: string | null;
  specialistPickupAt: string | null;
  serviceStartedAt: string | null;
  completedAt: string | null;
  lastActivityAt: string;
  lastReminderAt: string | null;
  version: number;
};

export type FieldOrder = {
  id: string;
  specialistId: string | null;
  driverId: string | null;
  arrivalAt: string;
  durationMinutes: number;
  tripType: TripType;
  customerName: string | null;
  customerPhone: string;
  customerLocation: string;
  specialistName: string | null;
  driverName: string | null;
  progress: FieldOrderProgress;
  nextAction: FieldOrderAction | null;
  nextActionLabel: string | null;
  canAct: boolean;
};
