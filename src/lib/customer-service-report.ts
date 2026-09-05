import "server-only";

import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import {
  OPERATIONS_TIME_ZONE,
  type OperationsReportInput,
  validateOperationsReportInput,
} from "@/lib/operations-report";

const PAGE_SIZE = 1_000;
export const EMPLOYEE_ONLINE_WINDOW_SECONDS = 120;

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
  timeZone: typeof OPERATIONS_TIME_ZONE;
  generatedAt: string;
  onlineWindowSeconds: typeof EMPLOYEE_ONLINE_WINDOW_SECONDS;
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

export type CustomerServiceEmployeeActivitiesInput = OperationsReportInput & {
  personId: string;
  limit?: number;
  offset?: number;
};

export type CustomerServiceEmployeeActivitiesResponse = {
  activities: CustomerServiceActivity[];
  total: number;
  hasMore: boolean;
  nextOffset: number | null;
};

type MemberRow = {
  id: string;
  user_id: string;
  role: "admin" | "agent";
  full_name: string;
  is_active: boolean;
};
type ConversationRow = {
  id: string;
  customer_name: string | null;
  customer_phone: string;
  assigned_to: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
};
type PresenceRow = {
  team_member_id: string;
  state: "active" | "background";
  platform: "ios" | "android" | "web";
  last_seen_at: string;
};
type MessageRow = {
  id: string;
  conversation_id: string;
  role: "customer" | "agent" | "system";
  sender_team_member_id: string | null;
  created_at: string;
};
type EventRow = {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  occurred_at: string;
  actor_team_member_id: string | null;
  actor_user_id: string | null;
  payload: Record<string, unknown> | null;
};
type ClaimRow = {
  id: string;
  conversation_id: string;
  team_member_id: string;
  claimed_at: string;
};
type NoteRow = {
  id: string;
  conversation_id: string;
  author_user_id: string | null;
  created_at: string;
};
type OrderRow = {
  id: string;
  conversation_id: string;
  created_by: string | null;
  created_at: string;
};

type MutableEmployee = CustomerServiceEmployee & {
  handledIds: Set<string>;
  resolvedIds: Set<string>;
  responseMinutesTotal: number;
  responseSamples: number;
  dailyMap: Map<string, { conversations: Set<string>; messages: number; actions: number }>;
};

function boundary(day: string, time: string): string {
  return `${day}T${time}:00+03:00`;
}

function minuteOfDay(iso: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: OPERATIONS_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function timeToMinutes(value: string): number {
  const [hour = 0, minute = 0] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function insideWindow(at: string, start: number, end: number): boolean {
  const minute = minuteOfDay(at);
  return minute >= start && minute < end;
}

function dayOf(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: OPERATIONS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function csStatus(row: ConversationRow): "open" | "waiting" | "resolved" {
  const value = row.metadata?.cs_status;
  if (value === "open" || value === "waiting" || value === "resolved") return value;
  return row.status === "resolved" ? "resolved" : "open";
}

function eventKind(eventType: string): CustomerServiceActionKind {
  if (eventType === "conversation.released") return "release";
  if (eventType === "conversation.transferred") return "transfer";
  if (eventType === "conversation.taken_over") return "takeover";
  if (eventType === "conversation.status_changed") return "status";
  if (
    eventType === "conversation.stage_changed" ||
    eventType === "conversation.reminder_confirmed"
  ) return "booking";
  return "other";
}

const EVENT_LABELS: Record<string, string> = {
  "conversation.released": "أطلقت المحادثة",
  "conversation.transferred": "حوّلت المحادثة",
  "conversation.taken_over": "استلمت المحادثة من موظفة أخرى",
  "conversation.status_changed": "غيّرت حالة المحادثة",
  "conversation.stage_changed": "غيّرت مرحلة الحجز",
  "conversation.labels_changed": "عدّلت تصنيفات المحادثة",
  "conversation.section_changed": "غيّرت قسم المحادثة",
  "conversation.reminder_confirmed": "حدّثت متابعة الموعد",
  "conversation.bot_resumed": "أعادت المحادثة للبوت",
  "conversation.customer_renamed": "عدّلت اسم العميلة",
};

async function pageRows<T>(load: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const result = await load(from, from + PAGE_SIZE - 1);
    if (result.error) throw new Error(result.error.message);
    const page = (result.data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function memberEmails(rows: MemberRow[]): Promise<Map<string, string | null>> {
  const admin = getAdminSupabaseClient();
  const pairs = await Promise.all(
    rows.map(async (row) => {
      const result = await admin.auth.admin.getUserById(row.user_id);
      return [row.id, result.data.user?.email ?? null] as const;
    }),
  );
  return new Map(pairs);
}

export async function getCustomerServiceReport(
  raw: OperationsReportInput,
): Promise<CustomerServiceReport> {
  const input = validateOperationsReportInput(raw);
  const rangeStart = boundary(input.from, "00:00");
  const rangeEnd = boundary(input.to, "23:59");
  const rangeStartMs = new Date(rangeStart).getTime();
  const rangeEndMs = new Date(rangeEnd).getTime();
  const startMinute = timeToMinutes(input.startTime);
  const endMinute = timeToMinutes(input.endTime);
  const admin = getAdminSupabaseClient();

  const membersResult = await admin
    .from("team_members")
    .select("id, user_id, role, full_name, is_active")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .in("role", ["admin", "agent"])
    .order("created_at", { ascending: true });
  if (membersResult.error) throw new Error(membersResult.error.message);
  const members = (membersResult.data ?? []) as MemberRow[];
  const memberIds = members.map((member) => member.id);

  const [emails, conversations, presence, messages, events, claims, notes, orders] =
    await Promise.all([
      memberEmails(members),
      pageRows<ConversationRow>((from, to) =>
        admin
          .from("conversations")
          .select("id, customer_name, customer_phone, assigned_to, status, metadata")
          .eq("restaurant_id", KIARA_RESTAURANT_ID)
          .order("id", { ascending: true })
          .range(from, to),
      ),
      memberIds.length
        ? pageRows<PresenceRow>((from, to) =>
            admin
              .from("team_member_app_presence")
              .select("team_member_id, state, platform, last_seen_at")
              .eq("restaurant_id", KIARA_RESTAURANT_ID)
              .in("team_member_id", memberIds)
              .order("team_member_id", { ascending: true })
              .range(from, to),
          )
        : Promise.resolve([]),
      memberIds.length
        ? pageRows<MessageRow>((from, to) =>
            admin
              .from("messages")
              .select("id, conversation_id, role, sender_team_member_id, created_at, conversations!inner(restaurant_id)")
              .eq("conversations.restaurant_id", KIARA_RESTAURANT_ID)
              .gte("created_at", rangeStart)
              .lte("created_at", rangeEnd)
              .order("created_at", { ascending: true })
              .range(from, to),
          )
        : Promise.resolve([]),
      pageRows<EventRow>((from, to) =>
        admin
          .from("operation_events")
          .select("id, aggregate_type, aggregate_id, event_type, occurred_at, actor_team_member_id, actor_user_id, payload")
          .eq("restaurant_id", KIARA_RESTAURANT_ID)
          .gte("occurred_at", rangeStart)
          .lte("occurred_at", rangeEnd)
          .order("occurred_at", { ascending: true })
          .range(from, to),
      ),
      memberIds.length
        ? pageRows<ClaimRow>((from, to) =>
            admin
              .from("conversation_claim_events")
              .select("id, conversation_id, team_member_id, claimed_at")
              .eq("restaurant_id", KIARA_RESTAURANT_ID)
              .eq("event_type", "claim")
              .in("team_member_id", memberIds)
              .gte("claimed_at", rangeStart)
              .lte("claimed_at", rangeEnd)
              .order("claimed_at", { ascending: true })
              .range(from, to),
          )
        : Promise.resolve([]),
      pageRows<NoteRow>((from, to) =>
        admin
          .from("conversation_internal_notes")
          .select("id, conversation_id, author_user_id, created_at")
          .eq("restaurant_id", KIARA_RESTAURANT_ID)
          .order("created_at", { ascending: true })
          .range(from, to),
      ),
      pageRows<OrderRow>((from, to) =>
        admin
          .from("driver_orders")
          .select("id, conversation_id, created_by, created_at")
          .eq("restaurant_id", KIARA_RESTAURANT_ID)
          .gte("created_at", rangeStart)
          .lte("created_at", rangeEnd)
          .order("created_at", { ascending: true })
          .range(from, to),
      ),
    ]);

  const presenceByMember = new Map(presence.map((row) => [row.team_member_id, row]));
  const memberByUser = new Map(members.map((row) => [row.user_id, row.id]));
  const conversationById = new Map(conversations.map((row) => [row.id, row]));
  const orderById = new Map(orders.map((row) => [row.id, row]));
  const now = Date.now();
  const employees = new Map<string, MutableEmployee>();

  for (const member of members) {
    const seen = presenceByMember.get(member.id);
    const lastSeenMs = seen ? new Date(seen.last_seen_at).getTime() : 0;
    employees.set(member.id, {
      teamMemberId: member.id,
      name: member.full_name?.trim() || emails.get(member.id)?.split("@")[0] || "موظفة",
      email: emails.get(member.id) ?? null,
      role: member.role,
      isEmploymentActive: member.is_active,
      activeNow:
        member.is_active &&
        seen?.state === "active" &&
        Number.isFinite(lastSeenMs) &&
        now - lastSeenMs <= EMPLOYEE_ONLINE_WINDOW_SECONDS * 1_000,
      appState: seen?.state ?? null,
      platform: seen?.platform ?? null,
      lastSeenAt: seen?.last_seen_at ?? null,
      lastActionAt: null,
      currentAssigned: 0,
      currentRunning: 0,
      currentWaiting: 0,
      currentResolved: 0,
      handledConversations: 0,
      resolvedConversations: 0,
      averageFirstResponseMinutes: null,
      messagesSent: 0,
      actions: 0,
      claims: 0,
      releases: 0,
      transfers: 0,
      takeovers: 0,
      statusChanges: 0,
      bookingActions: 0,
      notesAdded: 0,
      ordersCreated: 0,
      daily: [],
      recentActivity: [],
      handledIds: new Set(),
      resolvedIds: new Set(),
      responseMinutesTotal: 0,
      responseSamples: 0,
      dailyMap: new Map(),
    });
  }

  for (const conversation of conversations) {
    if (!conversation.assigned_to) continue;
    const employee = employees.get(conversation.assigned_to);
    if (!employee) continue;
    employee.currentAssigned += 1;
    const status = csStatus(conversation);
    if (status === "open") employee.currentRunning += 1;
    else if (status === "waiting") employee.currentWaiting += 1;
    else employee.currentResolved += 1;
  }

  const touch = (inputActivity: {
    memberId: string | null | undefined;
    id: string;
    at: string;
    conversationId: string;
    kind: CustomerServiceActionKind;
    title: string;
    isMessage?: boolean;
  }) => {
    if (!inputActivity.memberId || !insideWindow(inputActivity.at, startMinute, endMinute)) return;
    const employee = employees.get(inputActivity.memberId);
    if (!employee) return;
    const conversation = conversationById.get(inputActivity.conversationId);
    employee.handledIds.add(inputActivity.conversationId);
    if (!employee.lastActionAt || inputActivity.at > employee.lastActionAt) {
      employee.lastActionAt = inputActivity.at;
    }
    if (inputActivity.isMessage) employee.messagesSent += 1;
    else employee.actions += 1;
    const day = dayOf(inputActivity.at);
    const daily = employee.dailyMap.get(day) ?? {
      conversations: new Set<string>(),
      messages: 0,
      actions: 0,
    };
    daily.conversations.add(inputActivity.conversationId);
    if (inputActivity.isMessage) daily.messages += 1;
    else daily.actions += 1;
    employee.dailyMap.set(day, daily);
  };

  for (const row of messages) {
    if (row.role !== "agent" || !row.sender_team_member_id) continue;
    touch({
      memberId: row.sender_team_member_id,
      id: `message:${row.id}`,
      at: row.created_at,
      conversationId: row.conversation_id,
      kind: "reply",
      title: "أرسلت رداً للعميلة",
      isMessage: true,
    });
  }
  const messagesByConversation = new Map<string, MessageRow[]>();
  for (const row of messages) {
    const bucket = messagesByConversation.get(row.conversation_id) ?? [];
    bucket.push(row);
    messagesByConversation.set(row.conversation_id, bucket);
  }
  for (const rows of messagesByConversation.values()) {
    const firstInboundIndex = rows.findIndex((row) => row.role === "customer");
    if (firstInboundIndex < 0) continue;
    const inbound = rows[firstInboundIndex]!;
    const reply = rows
      .slice(firstInboundIndex + 1)
      .find((row) => row.role === "agent" && row.sender_team_member_id);
    if (!reply?.sender_team_member_id || !insideWindow(reply.created_at, startMinute, endMinute)) continue;
    const employee = employees.get(reply.sender_team_member_id);
    if (!employee) continue;
    const responseMinutes = Math.max(
      0,
      (new Date(reply.created_at).getTime() - new Date(inbound.created_at).getTime()) / 60_000,
    );
    if (!Number.isFinite(responseMinutes)) continue;
    employee.responseMinutesTotal += responseMinutes;
    employee.responseSamples += 1;
  }
  for (const row of claims) {
    const employee = employees.get(row.team_member_id);
    if (employee && insideWindow(row.claimed_at, startMinute, endMinute)) employee.claims += 1;
    touch({
      memberId: row.team_member_id,
      id: `claim:${row.id}`,
      at: row.claimed_at,
      conversationId: row.conversation_id,
      kind: "claim",
      title: "استلمت المحادثة",
    });
  }
  for (const row of events) {
    const relatedConversationId =
      row.aggregate_type === "conversation"
        ? row.aggregate_id
        : row.aggregate_type === "driver_order"
          ? orderById.get(row.aggregate_id)?.conversation_id
          : null;
    if (!relatedConversationId) continue;
    const memberId = row.actor_team_member_id ?? (row.actor_user_id ? memberByUser.get(row.actor_user_id) : null);
    if (!memberId || !insideWindow(row.occurred_at, startMinute, endMinute)) continue;
    const employee = employees.get(memberId);
    if (!employee) continue;
    const kind = eventKind(row.event_type);
    if (kind === "release") employee.releases += 1;
    else if (kind === "transfer") employee.transfers += 1;
    else if (kind === "takeover") employee.takeovers += 1;
    else if (kind === "status") employee.statusChanges += 1;
    else if (kind === "booking") employee.bookingActions += 1;
    touch({
      memberId,
      id: `event:${row.id}`,
      at: row.occurred_at,
      conversationId: relatedConversationId,
      kind: row.aggregate_type === "driver_order" ? "order" : kind,
      title:
        row.aggregate_type === "driver_order"
          ? "نفّذت إجراءً على الطلب"
          : EVENT_LABELS[row.event_type] ?? "نفّذت إجراءً على المحادثة",
    });
    if (row.event_type === "conversation.status_changed" && row.payload?.to === "resolved") {
      employee.resolvedIds.add(relatedConversationId);
    }
  }
  for (const row of notes) {
    const memberId = row.author_user_id ? memberByUser.get(row.author_user_id) : null;
    if (memberId && insideWindow(row.created_at, startMinute, endMinute)) {
      const employee = employees.get(memberId);
      if (employee) employee.notesAdded += 1;
    }
    touch({
      memberId,
      id: `note:${row.id}`,
      at: row.created_at,
      conversationId: row.conversation_id,
      kind: "note",
      title: "أضافت ملاحظة داخلية",
    });
  }
  for (const row of orders) {
    const createdAtMs = new Date(row.created_at).getTime();
    if (createdAtMs < rangeStartMs || createdAtMs > rangeEndMs) continue;
    const memberId = row.created_by ? memberByUser.get(row.created_by) : null;
    if (memberId && insideWindow(row.created_at, startMinute, endMinute)) {
      const employee = employees.get(memberId);
      if (employee) employee.ordersCreated += 1;
    }
    touch({
      memberId,
      id: `order:${row.id}`,
      at: row.created_at,
      conversationId: row.conversation_id,
      kind: "order",
      title: "أنشأت طلب خدمة",
    });
  }

  for (const employee of employees.values()) {
    employee.handledConversations = employee.handledIds.size;
    employee.resolvedConversations = employee.resolvedIds.size;
    employee.averageFirstResponseMinutes = employee.responseSamples
      ? Math.round((employee.responseMinutesTotal / employee.responseSamples) * 10) / 10
      : null;
    employee.daily = [...employee.dailyMap.entries()]
      .map(([day, value]) => ({
        day,
        handledConversations: value.conversations.size,
        messagesSent: value.messages,
        actions: value.actions,
      }))
      .sort((a, b) => b.day.localeCompare(a.day));
  }

  const output = [...employees.values()]
    .sort(
      (a, b) =>
        Number(b.activeNow) - Number(a.activeNow) ||
        b.handledConversations - a.handledConversations ||
        b.messagesSent + b.actions - (a.messagesSent + a.actions) ||
        a.name.localeCompare(b.name, "ar"),
    )
    .map(({
      handledIds: _handledIds,
      resolvedIds: _resolvedIds,
      responseMinutesTotal: _responseMinutesTotal,
      responseSamples: _responseSamples,
      dailyMap: _dailyMap,
      ...employee
    }) => employee);
  // recentActivity is capped per employee, so use the uncapped sets for totals.
  const allHandled = new Set<string>();
  for (const employee of employees.values()) {
    for (const id of employee.handledIds) allHandled.add(id);
  }

  return {
    ...input,
    timeZone: OPERATIONS_TIME_ZONE,
    generatedAt: new Date().toISOString(),
    onlineWindowSeconds: EMPLOYEE_ONLINE_WINDOW_SECONDS,
    totals: {
      employees: output.filter((employee) => employee.isEmploymentActive).length,
      activeNow: output.filter((employee) => employee.activeNow).length,
      handledConversations: allHandled.size,
      currentAssigned: output.reduce((sum, employee) => sum + employee.currentAssigned, 0),
      messagesSent: output.reduce((sum, employee) => sum + employee.messagesSent, 0),
      actions: output.reduce((sum, employee) => sum + employee.actions, 0),
    },
    employees: output,
  };
}

export async function getCustomerServiceEmployeeActivities(
  raw: CustomerServiceEmployeeActivitiesInput,
): Promise<CustomerServiceEmployeeActivitiesResponse> {
  const input = validateOperationsReportInput(raw);
  const personId = raw.personId;
  const limit = Math.max(1, Math.min(100, raw.limit ?? 20));
  const offset = Math.max(0, raw.offset ?? 0);

  if (!personId) {
    return { activities: [], total: 0, hasMore: false, nextOffset: null };
  }

  const rangeStart = boundary(input.from, "00:00");
  const rangeEnd = boundary(input.to, "23:59");
  const startMinute = timeToMinutes(input.startTime);
  const endMinute = timeToMinutes(input.endTime);
  const admin = getAdminSupabaseClient();

  const memberResult = await admin
    .from("team_members")
    .select("id, user_id")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .eq("id", personId)
    .maybeSingle();

  if (memberResult.error || !memberResult.data) {
    return { activities: [], total: 0, hasMore: false, nextOffset: null };
  }

  const member = memberResult.data;

  const [messages, claims, events, notes, orders] = await Promise.all([
    pageRows<MessageRow>((from, to) =>
      admin
        .from("messages")
        .select("id, conversation_id, role, sender_team_member_id, created_at, conversations!inner(restaurant_id)")
        .eq("conversations.restaurant_id", KIARA_RESTAURANT_ID)
        .eq("sender_team_member_id", personId)
        .eq("role", "agent")
        .gte("created_at", rangeStart)
        .lte("created_at", rangeEnd)
        .order("created_at", { ascending: false })
        .range(from, to),
    ),
    pageRows<ClaimRow>((from, to) =>
      admin
        .from("conversation_claim_events")
        .select("id, conversation_id, team_member_id, claimed_at")
        .eq("restaurant_id", KIARA_RESTAURANT_ID)
        .eq("event_type", "claim")
        .eq("team_member_id", personId)
        .gte("claimed_at", rangeStart)
        .lte("claimed_at", rangeEnd)
        .order("claimed_at", { ascending: false })
        .range(from, to),
    ),
    pageRows<EventRow>((from, to) =>
      admin
        .from("operation_events")
        .select("id, aggregate_type, aggregate_id, event_type, occurred_at, actor_team_member_id, actor_user_id, payload")
        .eq("restaurant_id", KIARA_RESTAURANT_ID)
        .or(`actor_team_member_id.eq.${personId}${member.user_id ? `,actor_user_id.eq.${member.user_id}` : ""}`)
        .gte("occurred_at", rangeStart)
        .lte("occurred_at", rangeEnd)
        .order("occurred_at", { ascending: false })
        .range(from, to),
    ),
    member.user_id
      ? pageRows<NoteRow>((from, to) =>
          admin
            .from("conversation_internal_notes")
            .select("id, conversation_id, author_user_id, created_at")
            .eq("restaurant_id", KIARA_RESTAURANT_ID)
            .eq("author_user_id", member.user_id)
            .gte("created_at", rangeStart)
            .lte("created_at", rangeEnd)
            .order("created_at", { ascending: false })
            .range(from, to),
        )
      : Promise.resolve([]),
    member.user_id
      ? pageRows<OrderRow>((from, to) =>
          admin
            .from("driver_orders")
            .select("id, conversation_id, created_by, created_at")
            .eq("restaurant_id", KIARA_RESTAURANT_ID)
            .eq("created_by", member.user_id)
            .gte("created_at", rangeStart)
            .lte("created_at", rangeEnd)
            .order("created_at", { ascending: false })
            .range(from, to),
        )
      : Promise.resolve([]),
  ]);

  const driverOrderIds = events
    .filter((e) => e.aggregate_type === "driver_order")
    .map((e) => e.aggregate_id);
  const driverOrdersMap = new Map<string, string>();
  if (driverOrderIds.length > 0) {
    const driverOrdersRes = await admin
      .from("driver_orders")
      .select("id, conversation_id")
      .in("id", driverOrderIds);
    if (driverOrdersRes.data) {
      for (const row of driverOrdersRes.data as { id: string; conversation_id: string }[]) {
        driverOrdersMap.set(row.id, row.conversation_id);
      }
    }
  }

  type RawActivityItem = {
    id: string;
    at: string;
    kind: CustomerServiceActionKind;
    title: string;
    conversationId: string;
  };

  const rawActivities: RawActivityItem[] = [];

  for (const row of messages) {
    if (insideWindow(row.created_at, startMinute, endMinute)) {
      rawActivities.push({
        id: `message:${row.id}`,
        at: row.created_at,
        kind: "reply",
        title: "أرسلت رداً للعميلة",
        conversationId: row.conversation_id,
      });
    }
  }

  for (const row of claims) {
    if (insideWindow(row.claimed_at, startMinute, endMinute)) {
      rawActivities.push({
        id: `claim:${row.id}`,
        at: row.claimed_at,
        kind: "claim",
        title: "استلمت المحادثة",
        conversationId: row.conversation_id,
      });
    }
  }

  for (const row of events) {
    const relatedConversationId =
      row.aggregate_type === "conversation"
        ? row.aggregate_id
        : row.aggregate_type === "driver_order"
          ? driverOrdersMap.get(row.aggregate_id)
          : null;
    if (!relatedConversationId || !insideWindow(row.occurred_at, startMinute, endMinute)) continue;
    const kind = eventKind(row.event_type);
    rawActivities.push({
      id: `event:${row.id}`,
      at: row.occurred_at,
      kind: row.aggregate_type === "driver_order" ? "order" : kind,
      title:
        row.aggregate_type === "driver_order"
          ? "نفّذت إجراءً على الطلب"
          : EVENT_LABELS[row.event_type] ?? "نفّذت إجراءً على المحادثة",
      conversationId: relatedConversationId,
    });
  }

  for (const row of notes) {
    if (insideWindow(row.created_at, startMinute, endMinute)) {
      rawActivities.push({
        id: `note:${row.id}`,
        at: row.created_at,
        kind: "note",
        title: "أضافت ملاحظة داخلية",
        conversationId: row.conversation_id,
      });
    }
  }

  for (const row of orders) {
    if (insideWindow(row.created_at, startMinute, endMinute)) {
      rawActivities.push({
        id: `order:${row.id}`,
        at: row.created_at,
        kind: "order",
        title: "أنشأت طلب خدمة",
        conversationId: row.conversation_id,
      });
    }
  }

  rawActivities.sort((a, b) => b.at.localeCompare(a.at));

  const total = rawActivities.length;
  const pageSlice = rawActivities.slice(offset, offset + limit);

  const conversationIds = Array.from(new Set(pageSlice.map((a) => a.conversationId)));
  const conversationMap = new Map<string, { customer_name: string | null; customer_phone: string }>();

  if (conversationIds.length > 0) {
    const convRes = await admin
      .from("conversations")
      .select("id, customer_name, customer_phone")
      .in("id", conversationIds);
    if (convRes.data) {
      for (const conv of convRes.data as { id: string; customer_name: string | null; customer_phone: string }[]) {
        conversationMap.set(conv.id, conv);
      }
    }
  }

  const activities: CustomerServiceActivity[] = pageSlice.map((item) => {
    const conv = conversationMap.get(item.conversationId);
    return {
      id: item.id,
      at: item.at,
      kind: item.kind,
      title: item.title,
      conversationId: item.conversationId,
      customerName: conv?.customer_name ?? null,
      customerPhone: conv?.customer_phone ?? null,
    };
  });

  const hasMore = offset + limit < total;
  const nextOffset = hasMore ? offset + limit : null;

  return {
    activities,
    total,
    hasMore,
    nextOffset,
  };
}
