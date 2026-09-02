/**
 * The responsibility trail: who held a conversation, what they did while they
 * held it, and who did what to an order.
 *
 * Everything here is read from records the app already writes — claim events,
 * `operation_events`, messages, internal notes, the order rows themselves —
 * and stitched into one chronology. Nothing is inferred from the current state
 * of a row, because current state cannot say who put it there.
 *
 * The conversation report is built as *periods of custody*. A thread moves
 * between people: taken, released, transferred, taken over by an admin, handed
 * back to the bot. Every action and every message is filed under the period it
 * happened in, so "who was responsible when this went wrong" has one answer
 * instead of a timestamp the owner has to reconcile by hand.
 */
import { BOOKING_STAGE_LABEL } from "@/lib/booking-stage";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";

export interface AuditPerson {
  /** team member id, user id, or roster id — whatever identified the actor. */
  key: string;
  name: string;
  /** admin | agent | specialist | driver | owner | bot | system */
  role: string;
}

export interface AuditEntry {
  at: string;
  type: string;
  /** Arabic, phrased as something a person did. */
  title: string;
  detail: string | null;
  actor: AuditPerson | null;
}

export interface CustodyPeriod {
  /** Null while the thread sat unassigned or with the bot. */
  holder: AuditPerson | null;
  from: string;
  /** Null for the period still running. */
  to: string | null;
  /** How this period began. */
  startedBy: "start" | "claim" | "reassign" | "takeover" | "release" | "bot";
  /** Who caused the handover, when that was someone other than the holder. */
  startedByActor: AuditPerson | null;
  inboundMessages: number;
  outboundMessages: number;
  actions: AuditEntry[];
}

export interface ConversationAuditReport {
  conversationId: string;
  customerName: string | null;
  customerPhone: string;
  startedAt: string | null;
  currentHolder: AuditPerson | null;
  periods: CustodyPeriod[];
  /** Outbound messages by the employee credited on the message row itself. */
  messagesByPerson: { person: AuditPerson; messages: number }[];
  totals: {
    inbound: number;
    outbound: number;
    actions: number;
    handovers: number;
  };
}

export interface OrderAuditLog {
  orderId: string;
  createdAt: string;
  createdBy: AuditPerson | null;
  customerName: string | null;
  customerPhone: string;
  arrivalAt: string;
  entries: AuditEntry[];
}

const CS_STATUS_LABEL: Record<string, string> = {
  open: "جاري المحادثة",
  waiting: "استفسار",
  resolved: "تم الطلب",
};

const FIELD_STEP_LABEL: Record<string, string> = {
  confirm_ride: "أكّد الرحلة وانطلق",
  driver_arrived: "وصل السائق إلى الأخصائية",
  confirm_pickup: "ركبت الأخصائية مع السائق",
  start_service: "بدأت الخدمة عند العميلة",
  complete_order: "أُنهيت الخدمة",
  driver_return: "انتهت الرحلة والعودة",
  reminder_sent: "أُرسل تذكير",
};

const EVENT_TITLE: Record<string, string> = {
  "conversation.claimed": "استلمت المحادثة",
  "conversation.released": "أطلقت المحادثة",
  "conversation.transferred": "حوّلت المحادثة",
  "conversation.taken_over": "سحبت المحادثة",
  "conversation.status_changed": "غيّرت حالة المحادثة",
  "conversation.stage_changed": "غيّرت مرحلة متابعة الحجز",
  "conversation.labels_changed": "عدّلت التصنيفات",
  "conversation.section_changed": "غيّرت القسم",
  "conversation.reminder_confirmed": "حدّثت متابعة الموعد",
  "conversation.note_added": "أضافت ملاحظة داخلية",
  "conversation.bot_resumed": "أعادت المحادثة للبوت",
  "conversation.customer_renamed": "عدّلت اسم العميلة",
  "order.created": "أنشأت طلب سائق",
  "order.updated": "عدّلت بيانات الطلب",
  "order.dispatch_prepared": "أسندت الطلب للسائق والأخصائية",
  "order.dispatch_completed": "اكتمل إسناد الطلب",
  "rekaz.sync_completed": "مزامنة حجوزات ركاز",
};

type Payload = Record<string, unknown>;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** The human-readable "what changed", built from the payload each writer stored. */
function describe(eventType: string, payload: Payload): string | null {
  switch (eventType) {
    case "conversation.status_changed": {
      const from = text(payload.from);
      const to = text(payload.to);
      return `${from ? CS_STATUS_LABEL[from] ?? from : "—"} ← ${to ? CS_STATUS_LABEL[to] ?? to : "—"}`;
    }
    case "conversation.stage_changed": {
      const from = text(payload.from);
      const to = text(payload.to);
      return `${from ? BOOKING_STAGE_LABEL[from as keyof typeof BOOKING_STAGE_LABEL] ?? from : "بدون مرحلة"} ← ${
        to ? BOOKING_STAGE_LABEL[to as keyof typeof BOOKING_STAGE_LABEL] ?? to : "بدون مرحلة"
      }`;
    }
    case "conversation.labels_changed": {
      const added = list(payload.added);
      const removed = list(payload.removed);
      const parts: string[] = [];
      if (added.length) parts.push(`أضافت: ${added.join("، ")}`);
      if (removed.length) parts.push(`أزالت: ${removed.join("، ")}`);
      return parts.join(" · ") || null;
    }
    case "conversation.reminder_confirmed": {
      const to = text(payload.to);
      const day = text(payload.dayKey);
      const state = to === "confirmed" ? "تم تأكيد الحضور" : "بانتظار رد العميلة";
      return day ? `${state} · ${day}` : state;
    }
    case "conversation.section_changed": {
      const to = text(payload.to);
      return to === "orders" ? "قسم الطلبات" : to === "replies" ? "قسم الردود" : "بدون قسم";
    }
    case "conversation.customer_renamed":
      return text(payload.to) ?? "أُزيل الاسم";
    case "conversation.taken_over":
      return text(payload.reason);
    case "order.updated": {
      const patch = (payload.patch ?? {}) as Payload;
      const fields: Record<string, string> = {
        arrivalAt: "الموعد",
        customerLocation: "الموقع",
        durationMinutes: "المدة",
        tripType: "نوع الرحلة",
        specialistId: "الأخصائية",
        driverId: "السائق",
        price: "الأجرة",
      };
      const changed = Object.keys(patch)
        .map((key) => fields[key])
        .filter(Boolean);
      return changed.length ? changed.join("، ") : null;
    }
    case "order.dispatch_completed": {
      // Historic rows carry the two WhatsApp delivery flags; app-only
      // dispatches are always complete, so they get the plain line.
      const driver = payload.driverSent === true;
      const specialist = payload.specialistSent;
      if (driver && specialist !== false) return "ظهر الطلب في تطبيقهما";
      const parts = [
        `السائق: ${driver ? "وصلت" : "لم تصل"}`,
        specialist === null || specialist === undefined
          ? null
          : `الأخصائية: ${specialist === true ? "وصلت" : "لم تصل"}`,
      ].filter(Boolean);
      return parts.join(" · ");
    }
    case "field.reminder_sent": {
      const channel = text(payload.channel);
      const role = text(payload.role);
      const who = role === "driver" ? "السائق" : role === "specialist" ? "الأخصائية" : null;
      return [who, channel].filter(Boolean).join(" · ") || null;
    }
    default:
      return null;
  }
}

function titleOf(eventType: string, payload: Payload): string {
  if (EVENT_TITLE[eventType]) return EVENT_TITLE[eventType];
  if (eventType.startsWith("field.")) {
    const step = eventType.slice("field.".length);
    return FIELD_STEP_LABEL[step] ?? step;
  }
  return text(payload.title) ?? eventType;
}

/**
 * Names for every identity that can appear in a trail.
 *
 * Resolved from `team_members` (by both its own id and the auth user behind
 * it), the restaurant owner, and the field-staff accounts referenced by the
 * step events. Suspended members stay in the directory: history must keep
 * naming the person who acted, even after they leave.
 */
class Directory {
  private byTeamMember = new Map<string, AuditPerson>();
  private byUser = new Map<string, AuditPerson>();
  private byFieldAccount = new Map<string, AuditPerson>();

  static async load(fieldAccountIds: string[] = []): Promise<Directory> {
    const admin = getAdminSupabaseClient();
    const directory = new Directory();
    const [members, restaurant, fieldAccounts] = await Promise.all([
      admin
        .from("team_members")
        .select("id, user_id, full_name, role")
        .eq("restaurant_id", KIARA_RESTAURANT_ID),
      admin
        .from("restaurants")
        .select("owner_id")
        .eq("id", KIARA_RESTAURANT_ID)
        .maybeSingle(),
      fieldAccountIds.length
        ? admin
            .from("field_staff_accounts")
            .select(
              "id, role, specialists(full_name), drivers(full_name)",
            )
            .in("id", fieldAccountIds)
        : Promise.resolve({ data: [] as unknown[] }),
    ]);

    for (const row of (members.data ?? []) as Payload[]) {
      const person: AuditPerson = {
        key: String(row.id),
        name: text(row.full_name) ?? "موظفة",
        role: text(row.role) ?? "agent",
      };
      directory.byTeamMember.set(person.key, person);
      const userId = text(row.user_id);
      if (userId) directory.byUser.set(userId, person);
    }

    const ownerId = text((restaurant as { data?: Payload }).data?.owner_id);
    // The owner has no membership row, so without this every action she takes
    // reads as "غير معروف" — which is the opposite of an audit trail.
    if (ownerId && !directory.byUser.has(ownerId)) {
      directory.byUser.set(ownerId, { key: ownerId, name: "المالكة", role: "owner" });
    }

    for (const row of ((fieldAccounts as { data?: Payload[] }).data ?? []) as Payload[]) {
      const roster = (row.specialists ?? row.drivers) as Payload | Payload[] | null;
      const one = Array.isArray(roster) ? roster[0] : roster;
      directory.byFieldAccount.set(String(row.id), {
        key: String(row.id),
        name: text(one?.full_name) ?? (row.role === "driver" ? "سائق" : "أخصائية"),
        role: text(row.role) ?? "specialist",
      });
    }
    return directory;
  }

  member(id: string | null | undefined): AuditPerson | null {
    return id ? this.byTeamMember.get(id) ?? null : null;
  }

  user(id: string | null | undefined): AuditPerson | null {
    return id ? this.byUser.get(id) ?? null : null;
  }

  fieldStaff(id: string | null | undefined): AuditPerson | null {
    return id ? this.byFieldAccount.get(id) ?? null : null;
  }

  /** Best identity available on an `operation_events` row. */
  actorOf(row: Payload): AuditPerson | null {
    return (
      this.member(text(row.actor_team_member_id)) ??
      this.fieldStaff(text(row.actor_field_staff_account_id)) ??
      this.user(text(row.actor_user_id)) ??
      (row.actor_type === "system"
        ? { key: "system", name: "النظام", role: "system" }
        : null)
    );
  }
}

/** One conversation's custody trail, newest period last. */
export async function getConversationAuditReport(
  conversationId: string,
): Promise<ConversationAuditReport | null> {
  const admin = getAdminSupabaseClient();

  const { data: conversation } = await admin
    .from("conversations")
    .select("id, customer_name, customer_phone, started_at, assigned_to, handler_mode")
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  if (!conversation) return null;

  const [claims, events, messages, notes, orders] = await Promise.all([
    admin
      .from("conversation_claim_events")
      .select("team_member_id, mode, event_type, claimed_at, claimed_by_user_id")
      .eq("conversation_id", conversationId)
      .order("claimed_at", { ascending: true }),
    admin
      .from("operation_events")
      .select(
        "event_type, occurred_at, actor_type, actor_role, actor_user_id, actor_team_member_id, actor_field_staff_account_id, payload",
      )
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .eq("aggregate_type", "conversation")
      .eq("aggregate_id", conversationId)
      .order("occurred_at", { ascending: true }),
    admin
      .from("messages")
      .select("role, created_at, sender_team_member_id")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true }),
    admin
      .from("conversation_internal_notes")
      .select("body, created_at, author_user_id")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true }),
    admin
      .from("driver_orders")
      .select("id, created_at, created_by, arrival_at")
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true }),
  ]);

  const directory = await Directory.load();

  // --- custody boundaries, from both streams that can move a thread ---------
  type Boundary = {
    at: string;
    holder: AuditPerson | null;
    startedBy: CustodyPeriod["startedBy"];
    actor: AuditPerson | null;
  };
  const boundaries: Boundary[] = [];

  for (const row of ((claims.data ?? []) as Payload[])) {
    const at = text(row.claimed_at);
    if (!at) continue;
    const eventType = text(row.event_type);
    const holder = directory.member(text(row.team_member_id));
    const actor = directory.user(text(row.claimed_by_user_id)) ?? holder;
    if (eventType === "claim") {
      boundaries.push({ at, holder, startedBy: "claim", actor });
    } else if (eventType === "reassign") {
      boundaries.push({ at, holder, startedBy: "reassign", actor });
    } else {
      // force_bot / unassign — the thread is nobody's again.
      boundaries.push({
        at,
        holder: null,
        startedBy: eventType === "force_bot" ? "bot" : "release",
        actor,
      });
    }
  }

  for (const row of ((events.data ?? []) as Payload[])) {
    const at = text(row.occurred_at);
    const eventType = text(row.event_type);
    if (!at || !eventType) continue;
    if (eventType === "conversation.released") {
      boundaries.push({
        at,
        holder: null,
        startedBy: "release",
        actor: directory.actorOf(row),
      });
    }
    if (eventType === "conversation.taken_over") {
      const actor = directory.actorOf(row);
      boundaries.push({ at, holder: actor, startedBy: "takeover", actor });
    }
  }

  boundaries.sort((a, b) => a.at.localeCompare(b.at));

  const startedAt = text(conversation.started_at);
  const periods: CustodyPeriod[] = [];
  // Everything before the first claim belongs to the bot/queue, not to nobody:
  // messages land there and the owner still needs to see them.
  const firstAt = startedAt ?? boundaries[0]?.at ?? new Date().toISOString();
  periods.push({
    holder: null,
    from: firstAt,
    to: null,
    startedBy: "start",
    startedByActor: null,
    inboundMessages: 0,
    outboundMessages: 0,
    actions: [],
  });
  for (const boundary of boundaries) {
    const current = periods[periods.length - 1]!;
    if (boundary.at < current.from) continue;
    current.to = boundary.at;
    periods.push({
      holder: boundary.holder,
      from: boundary.at,
      to: null,
      startedBy: boundary.startedBy,
      startedByActor:
        boundary.actor && boundary.actor.key !== boundary.holder?.key
          ? boundary.actor
          : null,
      inboundMessages: 0,
      outboundMessages: 0,
      actions: [],
    });
  }

  const fileInto = (at: string): CustodyPeriod => {
    for (let index = periods.length - 1; index >= 0; index -= 1) {
      if (at >= periods[index]!.from) return periods[index]!;
    }
    return periods[0]!;
  };

  // --- messages -------------------------------------------------------------
  const messagesByPerson = new Map<string, { person: AuditPerson; messages: number }>();
  let inbound = 0;
  let outbound = 0;
  for (const row of ((messages.data ?? []) as Payload[])) {
    const at = text(row.created_at);
    if (!at) continue;
    const period = fileInto(at);
    if (row.role === "customer") {
      period.inboundMessages += 1;
      inbound += 1;
    } else if (row.role === "agent") {
      period.outboundMessages += 1;
      outbound += 1;
      // The message row credits its sender directly, which survives every
      // later handover — a period total cannot, so both are reported.
      const person = directory.member(text(row.sender_team_member_id));
      if (person) {
        const entry = messagesByPerson.get(person.key) ?? { person, messages: 0 };
        entry.messages += 1;
        messagesByPerson.set(person.key, entry);
      }
    }
  }

  // --- actions --------------------------------------------------------------
  const push = (entry: AuditEntry) => fileInto(entry.at).actions.push(entry);

  for (const boundary of boundaries) {
    push({
      at: boundary.at,
      type: `custody.${boundary.startedBy}`,
      title:
        boundary.startedBy === "claim"
          ? "استلمت المحادثة"
          : boundary.startedBy === "reassign"
            ? "حُوّلت المحادثة إليها"
            : boundary.startedBy === "takeover"
              ? "سحبت المحادثة"
              : boundary.startedBy === "bot"
                ? "أعيدت المحادثة للبوت"
                : "أُطلقت المحادثة",
      detail: boundary.holder ? boundary.holder.name : null,
      actor: boundary.actor ?? boundary.holder,
    });
  }

  for (const row of ((events.data ?? []) as Payload[])) {
    const at = text(row.occurred_at);
    const eventType = text(row.event_type);
    if (!at || !eventType) continue;
    // Handovers are already in the trail as custody entries.
    if (eventType === "conversation.released") continue;
    const payload = (row.payload ?? {}) as Payload;
    push({
      at,
      type: eventType,
      title: titleOf(eventType, payload),
      detail: describe(eventType, payload),
      actor: directory.actorOf(row),
    });
  }

  for (const row of ((notes.data ?? []) as Payload[])) {
    const at = text(row.created_at);
    if (!at) continue;
    const body = text(row.body) ?? "";
    push({
      at,
      type: "conversation.note_added",
      title: EVENT_TITLE["conversation.note_added"]!,
      detail: body.length > 140 ? `${body.slice(0, 140)}…` : body || null,
      actor: directory.user(text(row.author_user_id)),
    });
  }

  for (const row of ((orders.data ?? []) as Payload[])) {
    const at = text(row.created_at);
    if (!at) continue;
    push({
      at,
      type: "order.created",
      title: EVENT_TITLE["order.created"]!,
      detail: text(row.arrival_at),
      actor: directory.user(text(row.created_by)),
    });
  }

  for (const period of periods) period.actions.sort((a, b) => a.at.localeCompare(b.at));

  // A conversation that was never claimed has one empty opening period; drop
  // it rather than showing the owner a row that says nothing.
  const trimmed = periods.filter(
    (period, index) =>
      index > 0 ||
      period.actions.length > 0 ||
      period.inboundMessages > 0 ||
      period.outboundMessages > 0,
  );

  return {
    conversationId,
    customerName: text(conversation.customer_name),
    customerPhone: String(conversation.customer_phone),
    startedAt,
    currentHolder: directory.member(text(conversation.assigned_to)),
    periods: trimmed,
    messagesByPerson: [...messagesByPerson.values()].sort(
      (a, b) => b.messages - a.messages,
    ),
    totals: {
      inbound,
      outbound,
      actions: trimmed.reduce((sum, period) => sum + period.actions.length, 0),
      handovers: boundaries.length,
    },
  };
}

/** Everything that happened to one order, oldest first. */
export async function getOrderAuditLog(orderId: string): Promise<OrderAuditLog | null> {
  const admin = getAdminSupabaseClient();

  const { data: order } = await admin
    .from("driver_orders")
    .select(
      "id, conversation_id, created_at, created_by, arrival_at, customer_phone",
    )
    .eq("id", orderId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  if (!order) return null;

  const [events, conversation] = await Promise.all([
    admin
      .from("operation_events")
      .select(
        "event_type, occurred_at, actor_type, actor_role, actor_user_id, actor_team_member_id, actor_field_staff_account_id, payload",
      )
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .eq("aggregate_type", "driver_order")
      .eq("aggregate_id", orderId)
      .order("occurred_at", { ascending: true }),
    admin
      .from("conversations")
      .select("customer_name")
      .eq("id", order.conversation_id as string)
      .maybeSingle(),
  ]);

  const rows = (events.data ?? []) as Payload[];
  const directory = await Directory.load(
    [...new Set(rows.map((row) => text(row.actor_field_staff_account_id)).filter(Boolean))] as string[],
  );

  const entries: AuditEntry[] = rows.map((row) => {
    const payload = (row.payload ?? {}) as Payload;
    const eventType = String(row.event_type);
    return {
      at: String(row.occurred_at),
      type: eventType,
      title: titleOf(eventType, payload),
      detail: describe(eventType, payload),
      actor: directory.actorOf(row),
    };
  });

  const createdBy = directory.user(text(order.created_by));
  // The row is the only record of who raised the order — there is no
  // `order.created` event, and back-filling one would invent a timestamp.
  entries.unshift({
    at: String(order.created_at),
    type: "order.created",
    title: EVENT_TITLE["order.created"]!,
    detail: null,
    actor: createdBy,
  });
  entries.sort((a, b) => a.at.localeCompare(b.at));

  return {
    orderId,
    createdAt: String(order.created_at),
    createdBy,
    customerName: text((conversation.data as Payload | null)?.customer_name),
    customerPhone: String(order.customer_phone),
    arrivalAt: String(order.arrival_at),
    entries,
  };
}
