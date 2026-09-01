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

export type LabelColor =
  | "slate"
  | "red"
  | "amber"
  | "emerald"
  | "blue"
  | "indigo"
  | "fuchsia"
  | "rose";

export type ConversationLabel = {
  id: string;
  name: string;
  color: LabelColor;
};

export type BootstrapResponse = {
  apiVersion: 1;
  session: {
    userId: string;
    email: string | null;
    role: StaffRole;
    isOwner: boolean;
    teamMemberId: string | null;
    fieldStaffAccountId: string | null;
    rosterId: string | null;
    displayName: string | null;
  };
  capabilities: {
    canTakeConversations: boolean;
    canManageTeam: boolean;
    canViewOrderPrices: boolean;
    canViewReports: boolean;
  };
  inbox: {
    dangerAfterSeconds: number;
    views: { id: InboxView; label: string }[];
  };
  bookingStages: { id: BookingStage; label: string }[];
  agents: { id: string; fullName: string | null; email: string | null }[];
  labels: ConversationLabel[];
  savedReplies: SavedReply[];
};

/** A canned reply the team keeps for the questions that repeat. */
export type SavedReply = {
  id: string;
  title: string;
  body: string;
};

export type InboxView =
  | "new"
  | "mine"
  | "unassigned"
  | "specialists"
  | "drivers"
  | "groups"
  | "danger";

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
  /**
   * Somebody answered from the phone's WhatsApp app rather than from here.
   * Optional: older API builds don't send it.
   */
  handledOnWhatsApp?: boolean;
  /**
   * A WhatsApp group rather than a person. Optional: older API builds never
   * send groups at all, so an absent flag correctly means "not a group".
   */
  isGroup?: boolean;
  bookingStage: BookingStage | null;
  dangerMinutes: number | null;
  /** Every label currently assigned to the conversation. */
  labels?: ConversationLabel[];
  /**
   * The last line of the thread, for the list row. Absent on older API builds
   * — the row falls back to the number rather than showing an empty line.
   */
  lastMessage?: ConversationPreview | null;
};

/** The newest message in a thread, as the inbox list renders it. */
export type ConversationPreview = {
  at: string;
  role: "customer" | "agent" | "system";
  /** Who spoke, in a group. Absent on a 1:1 chat — there it is the customer. */
  participantName?: string | null;
  messageType: string;
  text: string;
  deliveryStatus: string | null;
};

/** One stored attachment on a message, as the engine and composer record it. */
export type MediaSlot = {
  storage_path: string | null;
  content_type: string;
  size_bytes: number | null;
  original_filename?: string | null;
  /** "stored" is the only state with bytes behind it. */
  delivery_status?: "stored" | "too_large" | "failed" | string;
};

/** The durable invoice/receipt attached to the booking workflow. */
export type BookingReceipt = {
  storagePath: string;
  contentType: string;
  sizeBytes: number | null;
  originalFilename: string | null;
  uploadedAt: string;
};

export type ConversationMessage = {
  id: string;
  conversation_id: string;
  role: "customer" | "agent" | "system";
  content: string;
  /** text | image | audio | voice | video | document | location | … */
  message_type: string;
  metadata?: { media?: MediaSlot[] } & Record<string, unknown> | null;
  delivery_status?: string | null;
  created_at: string;
};

/** A service or package from the spa's price list. */
export type CatalogItem = {
  id: string;
  name: string;
  description: string;
  price: number | null;
  currency: string;
  category: string;
  imageUrl: string | null;
  isAvailable: boolean;
};

/** The refinements that narrow whichever inbox view is open. */
export type ConversationFilters = {
  status: CsStatus | null;
  section: ConversationSection | null;
  labelId: string | null;
  /** Where the booking stands — مرحلة متابعة الحجز, as filed on the thread. */
  bookingStage: BookingStage | null;
  /** Who has dealt with the thread so far — المتابعة. */
  handling: ConversationHandling | null;
};

/**
 * The three ways a thread gets left behind, as the salon names them:
 * answered from the WhatsApp app instead of here, never opened at all, or
 * opened and then claimed by nobody.
 */
export type ConversationHandling = "whatsapp" | "unread" | "read_unclaimed";

/** قسم الطلبات / قسم الردود — how the owner files a thread. */
export type ConversationSection = "orders" | "replies";

export type InternalNote = {
  id: string;
  body: string;
  author_user_id: string | null;
  created_at: string;
};

/** Booking details the assistant collected, still waiting on a human. */
export type BookingRequest = {
  status: "pending";
  summary: string;
  service: string;
  time: string;
  location: string;
  /** ISO — when the assistant captured it. */
  at: string;
};

/** Where the customer already said she is, best evidence first. */
export type SharedLocation = {
  /** One line, ready to drop into the order's location field. */
  value: string;
  url: string | null;
  label: string | null;
  source: "pin" | "link" | "text";
  at: string;
};

export type ConversationDetail = {
  conversation: ConversationSummary & {
    reminderConfirmation: ReminderConfirmation | null;
    labelIds: string[];
    /** Detail-only; older API builds omit both. */
    section?: ConversationSection | null;
    routedTo?: string | null;
    /** Detail-only; older API builds omit it. */
    bookingRequest?: BookingRequest | null;
    /** Detail-only; older API builds omit it. */
    bookingReceipt?: BookingReceipt | null;
  };
  messages: ConversationMessage[];
  /** Detail-only; older API builds omit it. */
  sharedLocation?: SharedLocation | null;
  hasMore: boolean;
  nextBefore: string | null;
};

export type ConversationMessagesPage = {
  conversationId: string;
  messages: ConversationMessage[];
  hasMore: boolean;
  nextBefore: string | null;
};

/** What the chat screen's booking sheet sends to confirm an appointment. */
export type CreateOrderInput = {
  arrivalAt: string;
  customerLocation: string;
  durationMinutes: number;
  tripType: TripType;
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

export type ConversationActionsInput = {
  csStatus: CsStatus;
  bookingStage: BookingStage | null;
  labelIds: string[];
  reminderConfirmation: {
    dayKey: string;
    status: "awaiting_reply" | "confirmed";
  } | null;
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
  /**
   * Where the visit stands in the app's step machine. Null when the order was
   * never dispatched, and absent on older API builds — the screens fall back
   * to `specialist_session`/`driver_session` rather than blanking.
   */
  field_progress?: FieldOrderProgress | null;
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
  /**
   * A recording for the specialist, sent as a WhatsApp voice note right after
   * the booking copy. Spoken instructions carry further than written ones for
   * a specialist who reads little Arabic.
   */
  specialistVoice?: { uri: string; name: string; type: string } | null;
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

export type OperationsRole = "specialist" | "driver";

export type OperationsPerson = {
  id: string;
  name: string;
  isActive: boolean;
  source: "roster" | "rekaz";
  assignedCount: number;
  completedCount: number;
  scheduledMinutes: number;
  completedMinutes: number;
};

export type OperationsEvent = {
  id: string;
  visitKey: string;
  source: "rekaz" | "whatsapp";
  sourceLabel: "حجز ركاز" | "طلب واتساب";
  orderId: string | null;
  personIds: string[];
  arrivalAt: string;
  endsAt: string;
  durationMinutes: number;
  customerName: string;
  customerPhone: string;
  service: string;
  status: string;
  completed: boolean;
  completedAt: string | null;
};

export type OperationsReport = {
  from: string;
  to: string;
  startTime: string;
  endTime: string;
  timeZone: "Asia/Riyadh";
  generatedAt: string;
  people: Record<OperationsRole, OperationsPerson[]>;
  events: Record<OperationsRole, OperationsEvent[]>;
};

export type CustomerServiceActionKind =
  | "reply"
  | "claim"
  | "release"
  | "transfer"
  | "takeover"
  | "status"
  | "booking"
  | "note"
  | "order"
  | "other";

export type CustomerServiceActivity = {
  id: string;
  at: string;
  kind: CustomerServiceActionKind;
  title: string;
  conversationId: string;
  customerName: string | null;
  customerPhone: string | null;
};

export type CustomerServiceDailyActivity = {
  day: string;
  handledConversations: number;
  messagesSent: number;
  actions: number;
};

export type CustomerServiceEmployee = {
  teamMemberId: string;
  name: string;
  email: string | null;
  role: "admin" | "agent";
  isEmploymentActive: boolean;
  activeNow: boolean;
  appState: "active" | "background" | null;
  platform: "ios" | "android" | "web" | null;
  lastSeenAt: string | null;
  lastActionAt: string | null;
  currentAssigned: number;
  currentRunning: number;
  currentWaiting: number;
  currentResolved: number;
  handledConversations: number;
  resolvedConversations: number;
  averageFirstResponseMinutes: number | null;
  messagesSent: number;
  actions: number;
  claims: number;
  releases: number;
  transfers: number;
  takeovers: number;
  statusChanges: number;
  bookingActions: number;
  notesAdded: number;
  ordersCreated: number;
  daily: CustomerServiceDailyActivity[];
  recentActivity: CustomerServiceActivity[];
};

export type CustomerServiceReport = {
  from: string;
  to: string;
  startTime: string;
  endTime: string;
  timeZone: "Asia/Riyadh";
  generatedAt: string;
  onlineWindowSeconds: number;
  totals: {
    employees: number;
    activeNow: number;
    handledConversations: number;
    currentAssigned: number;
    messagesSent: number;
    actions: number;
  };
  employees: CustomerServiceEmployee[];
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
      /** The Rekaz order this service was booked under; one visit, one id. */
      orderId?: string;
      orderTotal?: number;
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

/** Mirrors `CustomerInsights` in src/lib/customer-timeline.ts. */
export type CustomerInsights = {
  topServices: { name: string; count: number; spend: number }[];
  favoriteProvider: { name: string; visits: number } | null;
  cancelledRate: number;
  avgSpend: number;
  lastVisitAt: string | null;
  nextVisitAt: string | null;
  daysSinceLastVisit: number | null;
  bookedOnline: number;
  bookedByStaff: number;
};

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
  // Older API builds predate the profile screen and omit this; the screen
  // falls back rather than crashing on a deploy skew.
  insights?: CustomerInsights;
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
  | "driver_arrived"
  | "confirm_pickup"
  | "start_service"
  | "complete_order"
  | "driver_return";

export type FieldOrderListView = "today" | "upcoming" | "previous" | "done";

export type FieldOrderProgress = {
  driverConfirmedAt: string | null;
  driverArrivedAt: string | null;
  specialistPickupAt: string | null;
  serviceStartedAt: string | null;
  completedAt: string | null;
  driverReturnedAt: string | null;
  lastActivityAt: string;
  lastReminderAt: string | null;
  version: number;
};

/** One person the reminder composer can address. */
export type OrderReminderRecipient = {
  role: FieldSessionRole;
  rosterId: string | null;
  name: string | null;
  phone: string | null;
  /** A live app account with at least one registered device. */
  canPush: boolean;
  /** A roster phone plus a connected WhatsApp engine. */
  canWhatsapp: boolean;
  /** True when the chain is currently waiting on this person. */
  isPending: boolean;
  pendingAction: FieldOrderAction | null;
  pendingLabel: string | null;
  /** The suggested text; fully editable before it is sent. */
  message: string;
};

export type OrderReminderContext = {
  orderId: string;
  customerName: string | null;
  customerPhone: string;
  arrivalAt: string;
  customerLocation: string;
  progress: FieldOrderProgress | null;
  pendingRole: FieldSessionRole | null;
  pendingAction: FieldOrderAction | null;
  pendingLabel: string | null;
  lastReminderAt: string | null;
  /** Minutes since anyone last touched the order. */
  stalledMinutes: number | null;
  whatsappConfigured: boolean;
  recipients: OrderReminderRecipient[];
};

export type OrderReminderChannel = "push" | "whatsapp";

export type SendOrderReminderInput = {
  role: FieldSessionRole;
  message: string;
  channels: OrderReminderChannel[];
};

export type OrderReminderDelivery = {
  role: FieldSessionRole;
  remindedAt: string;
  push: {
    attempted: number;
    accepted: number;
    delivered: number;
    pending: number;
    failed: number;
    errors: string[];
  } | null;
  whatsapp: { sent: boolean; error: string | null } | null;
  /** At least one requested channel actually left the building. */
  delivered: boolean;
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
  /** The driver's non-blocking "I've arrived at the specialist" ping is offered. */
  canPingArrival: boolean;
};

/* ── Responsibility trail ────────────────────────────────────────────────── */

/** Whoever acted: an employee, the owner, field staff, or the system itself. */
export type AuditPerson = {
  key: string;
  name: string;
  role: string;
};

export type AuditEntry = {
  at: string;
  type: string;
  title: string;
  detail: string | null;
  actor: AuditPerson | null;
};

/** One stretch of time a single person was responsible for the thread. */
export type CustodyPeriod = {
  holder: AuditPerson | null;
  from: string;
  to: string | null;
  startedBy: "start" | "claim" | "reassign" | "takeover" | "release" | "bot";
  startedByActor: AuditPerson | null;
  inboundMessages: number;
  outboundMessages: number;
  actions: AuditEntry[];
};

export type ConversationAuditReport = {
  conversationId: string;
  customerName: string | null;
  customerPhone: string;
  startedAt: string | null;
  currentHolder: AuditPerson | null;
  periods: CustodyPeriod[];
  messagesByPerson: { person: AuditPerson; messages: number }[];
  totals: { inbound: number; outbound: number; actions: number; handovers: number };
};

export type OrderAuditLog = {
  orderId: string;
  createdAt: string;
  createdBy: AuditPerson | null;
  customerName: string | null;
  customerPhone: string;
  arrivalAt: string;
  entries: AuditEntry[];
};
