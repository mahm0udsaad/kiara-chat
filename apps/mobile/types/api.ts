export type StaffRole = "admin" | "agent";

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

export type InboxView = "new" | "unassigned" | "danger";

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
  conversation: ConversationSummary;
  messages: ConversationMessage[];
  hasMore: boolean;
  nextBefore: string | null;
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
};

export type DispatchInput = {
  specialistId: string;
  driverId: string;
  specialistNote: string;
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
