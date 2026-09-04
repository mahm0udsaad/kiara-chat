import "server-only";

/**
 * Nudging the field team about a visit that is already on its way.
 *
 * The 30-minute cron in `kiara_private.enqueue_field_reminders` is the machine
 * half of this: it picks whoever the step machine says is late and pushes
 * wording it chose. This is the human half — an employee looking at a stalled
 * order picks the person, edits the text, and sends it as a push, a WhatsApp
 * message, or both.
 *
 * The two share `field_order_progress.last_reminder_at`: a reminder sent by
 * hand pushes the cron's next automatic nudge out by its own window, so the
 * driver is not told the same thing twice within a minute of each other.
 */

import {
  fieldStaffHasPushTokens,
  notifyFieldStaffReminder,
  type FieldPushDeliverySummary,
} from "@/lib/field-push";
import {
  nextFieldAction,
  type FieldOrderAction,
  type FieldStaffRole,
} from "@/lib/field-staff";
import { formatDuration, TRIP_TYPE_LABEL } from "@/lib/format";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { isOpenWaConfigured, openWaTransport } from "@/lib/transport/openwa";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import type { FieldOrderProgressState, TripType } from "@/lib/types";

export type FieldReminderChannel = "push" | "whatsapp";

export const FIELD_REMINDER_CHANNELS: FieldReminderChannel[] = [
  "push",
  "whatsapp",
];

export const FIELD_REMINDER_MAX_LENGTH = 1_500;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TZ = "Asia/Riyadh";
const ARRIVAL_FMT = new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TZ,
});

const ROLE_LABEL: Record<FieldStaffRole, string> = {
  driver: "السائق",
  specialist: "الأخصائية",
};

/** One recipient the composer can address, with what it may use to reach them. */
export interface FieldReminderRecipient {
  role: FieldStaffRole;
  rosterId: string | null;
  name: string | null;
  /** Present only when the roster row carries one; WhatsApp needs it. */
  phone: string | null;
  /** A live app account with at least one registered device. */
  canPush: boolean;
  /** A phone on the roster row and a connected WhatsApp engine. */
  canWhatsapp: boolean;
  /** True when the chain is currently waiting on this person. */
  isPending: boolean;
  /** The step the chain is waiting for — theirs or the other person's. */
  pendingAction: FieldOrderAction | null;
  pendingLabel: string | null;
  /** The suggested text. Fully editable before it is sent. */
  message: string;
}

export interface FieldReminderContext {
  orderId: string;
  customerName: string | null;
  customerPhone: string;
  arrivalAt: string;
  customerLocation: string;
  progress: FieldOrderProgressState | null;
  /** Whose turn it is, per the linear chain; null once the visit is closed. */
  pendingRole: FieldStaffRole | null;
  pendingAction: FieldOrderAction | null;
  pendingLabel: string | null;
  lastReminderAt: string | null;
  /** Minutes since anyone touched the order, for "stalled for …". */
  stalledMinutes: number | null;
  /** False when OPENWA is not configured — the composer hides that channel. */
  whatsappConfigured: boolean;
  recipients: FieldReminderRecipient[];
}

export interface FieldReminderResult {
  role: FieldStaffRole;
  remindedAt: string;
  push: FieldPushDeliverySummary | null;
  whatsapp: { sent: boolean; error: string | null } | null;
  /** At least one requested channel actually left the building. */
  delivered: boolean;
}

interface OrderRow {
  id: string;
  conversation_id: string;
  specialist_id: string | null;
  driver_id: string | null;
  arrival_at: string;
  customer_location: string;
  customer_phone: string;
  duration_minutes: number;
  trip_type: TripType;
}

const EMPTY_PROGRESS: FieldOrderProgressState = {
  driverConfirmedAt: null,
  driverArrivedAt: null,
  specialistPickupAt: null,
  serviceStartedAt: null,
  completedAt: null,
  driverReturnedAt: null,
  lastActivityAt: "",
  lastReminderAt: null,
  version: 1,
};

function progressOf(
  row: Record<string, unknown> | null,
): FieldOrderProgressState | null {
  if (!row) return null;
  return {
    driverConfirmedAt: (row.driver_confirmed_at as string | null) ?? null,
    driverArrivedAt: (row.driver_arrived_at as string | null) ?? null,
    specialistPickupAt: (row.specialist_pickup_at as string | null) ?? null,
    serviceStartedAt: (row.service_started_at as string | null) ?? null,
    completedAt: (row.completed_at as string | null) ?? null,
    driverReturnedAt: (row.driver_returned_at as string | null) ?? null,
    lastActivityAt:
      (row.last_activity_at as string | null) ?? new Date().toISOString(),
    lastReminderAt: (row.last_reminder_at as string | null) ?? null,
    version: Number(row.version ?? 1),
  };
}

/**
 * The message the composer opens with.
 *
 * Written for the two cases that actually happen: the step is this person's
 * and they have not done it, or the visit is waiting on their colleague and
 * this is a heads-up. Anything else — an order nobody has moved yet, a visit
 * already closed — falls back to a plain restatement of the appointment,
 * because a reminder that describes a step the reader cannot take is worse
 * than one that only says where to be and when.
 */
function suggestedMessage(input: {
  role: FieldStaffRole;
  name: string | null;
  order: OrderRow;
  customerName: string | null;
  pendingRole: FieldStaffRole | null;
  pendingLabel: string | null;
  otherName: string | null;
}): string {
  const greeting = input.name ? `مرحباً ${input.name} 👋` : "مرحباً 👋";
  const customer = input.customerName || input.order.customer_phone;
  const arrival = ARRIVAL_FMT.format(new Date(input.order.arrival_at));

  const lines = [
    greeting,
    "",
    `تذكير بطلب ${customer}`,
    `🕒 موعد الوصول: ${arrival}`,
    `⏱️ مدة الجلسة: ${formatDuration(input.order.duration_minutes)}`,
    `🚕 نوع الرحلة: ${TRIP_TYPE_LABEL[input.order.trip_type]}`,
    `📍 موقع العميلة: ${input.order.customer_location}`,
    "",
  ];

  if (!input.pendingRole || !input.pendingLabel) {
    lines.push("اكتملت خطوات هذا الطلب. برجاء المراجعة إن كان هناك أي ملاحظة.");
  } else if (input.pendingRole === input.role) {
    lines.push(
      `⚠️ الخطوة المطلوبة منك الآن: ${input.pendingLabel}.`,
      input.role === "driver"
        ? "📲 افتح تطبيق كيارا وسجّل الخطوة."
        : "📲 افتحي تطبيق كيارا وسجّلي الخطوة.",
    );
  } else {
    const who = input.otherName
      ? `${ROLE_LABEL[input.pendingRole]} ${input.otherName}`
      : ROLE_LABEL[input.pendingRole];
    lines.push(
      `الطلب بانتظار ${who}: ${input.pendingLabel}.`,
      input.role === "driver"
        ? "📲 تابع الطلب من تطبيق كيارا وكن على استعداد."
        : "📲 تابعي الطلب من تطبيق كيارا وكوني على استعداد.",
    );
  }

  return lines.join("\n").slice(0, FIELD_REMINDER_MAX_LENGTH);
}

async function loadOrder(orderId: string): Promise<OrderRow | null> {
  if (!UUID.test(orderId)) return null;
  const { data } = await getAdminSupabaseClient()
    .from("driver_orders")
    .select(
      "id, conversation_id, specialist_id, driver_id, arrival_at, customer_location, customer_phone, duration_minutes, trip_type",
    )
    .eq("id", orderId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  return (data as OrderRow | null) ?? null;
}

async function loadRoster(
  role: FieldStaffRole,
  rosterId: string | null,
): Promise<{ name: string | null; phone: string | null }> {
  if (!rosterId) return { name: null, phone: null };
  const { data } = await getAdminSupabaseClient()
    .from(role === "specialist" ? "specialists" : "drivers")
    .select("full_name, phone")
    .eq("id", rosterId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  return {
    name: (data?.full_name as string | null) ?? null,
    phone: (data?.phone as string | null) ?? null,
  };
}

/**
 * Everything the reminder composer needs in one read: where the visit stands,
 * who can be reached how, and the text to open with for each of them.
 */
export async function getFieldReminderContext(
  orderId: string,
): Promise<FieldReminderContext | null> {
  const order = await loadOrder(orderId);
  if (!order) return null;

  const admin = getAdminSupabaseClient();
  const [{ data: progressRow }, { data: conversation }, specialist, driver] =
    await Promise.all([
      admin
        .from("field_order_progress")
        .select("*")
        .eq("order_id", orderId)
        .eq("restaurant_id", KIARA_RESTAURANT_ID)
        .maybeSingle(),
      admin
        .from("conversations")
        .select("customer_name")
        .eq("id", order.conversation_id)
        .eq("restaurant_id", KIARA_RESTAURANT_ID)
        .maybeSingle(),
      loadRoster("specialist", order.specialist_id),
      loadRoster("driver", order.driver_id),
    ]);

  const progress = progressOf(
    (progressRow as Record<string, unknown> | null) ?? null,
  );
  const next = nextFieldAction(progress ?? EMPTY_PROGRESS);
  const customerName = (conversation?.customer_name as string | null) ?? null;
  const whatsappConfigured = isOpenWaConfigured();

  const [specialistHasPush, driverHasPush] = await Promise.all([
    order.specialist_id
      ? fieldStaffHasPushTokens("specialist", order.specialist_id)
      : Promise.resolve(false),
    order.driver_id
      ? fieldStaffHasPushTokens("driver", order.driver_id)
      : Promise.resolve(false),
  ]);

  const build = (
    role: FieldStaffRole,
    rosterId: string | null,
    person: { name: string | null; phone: string | null },
    hasPush: boolean,
    otherName: string | null,
  ): FieldReminderRecipient => ({
    role,
    rosterId,
    name: person.name,
    phone: person.phone,
    canPush: Boolean(rosterId) && hasPush,
    canWhatsapp: Boolean(person.phone) && whatsappConfigured,
    isPending: next.role === role,
    pendingAction: next.action,
    pendingLabel: next.label,
    message: suggestedMessage({
      role,
      name: person.name,
      order,
      customerName,
      pendingRole: next.role,
      pendingLabel: next.label,
      otherName,
    }),
  });

  const lastActivityAt = progress?.lastActivityAt || null;
  return {
    orderId,
    customerName,
    customerPhone: order.customer_phone,
    arrivalAt: order.arrival_at,
    customerLocation: order.customer_location,
    progress,
    pendingRole: next.role,
    pendingAction: next.action,
    pendingLabel: next.label,
    lastReminderAt: progress?.lastReminderAt ?? null,
    stalledMinutes:
      lastActivityAt && next.action
        ? Math.max(
            0,
            Math.round(
              (Date.now() - new Date(lastActivityAt).getTime()) / 60_000,
            ),
          )
        : null,
    whatsappConfigured,
    recipients: [
      build("driver", order.driver_id, driver, driverHasPush, specialist.name),
      build(
        "specialist",
        order.specialist_id,
        specialist,
        specialistHasPush,
        driver.name,
      ),
    ],
  };
}

export class FieldReminderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "FieldReminderError";
  }
}

/**
 * Send one employee-authored reminder.
 *
 * The requested channels are attempted independently and reported
 * independently: a WhatsApp engine that is down must not hide the fact that
 * the push went through, or the employee sends the whole thing again.
 */
export async function sendFieldReminder(input: {
  orderId: string;
  role: FieldStaffRole;
  message: string;
  channels: FieldReminderChannel[];
  actor: { userId: string; teamMemberId: string | null; role: string };
}): Promise<FieldReminderResult> {
  const message = input.message.trim().slice(0, FIELD_REMINDER_MAX_LENGTH);
  if (!message) {
    throw new FieldReminderError("EMPTY_REMINDER", "اكتبي نص التذكير قبل الإرسال.");
  }
  if (!input.channels.length) {
    throw new FieldReminderError(
      "NO_REMINDER_CHANNEL",
      "اختاري وسيلة إرسال واحدة على الأقل.",
    );
  }

  const order = await loadOrder(input.orderId);
  if (!order) {
    throw new FieldReminderError("ORDER_NOT_FOUND", "الطلب غير موجود", 404);
  }
  const rosterId =
    input.role === "specialist" ? order.specialist_id : order.driver_id;
  if (!rosterId) {
    throw new FieldReminderError(
      "RECIPIENT_NOT_ASSIGNED",
      input.role === "specialist"
        ? "لم يتم تحديد الأخصائية لهذا الطلب."
        : "لم يتم تحديد السائق لهذا الطلب.",
    );
  }
  const person = await loadRoster(input.role, rosterId);

  const wantsPush = input.channels.includes("push");
  const wantsWhatsapp = input.channels.includes("whatsapp");
  if (wantsWhatsapp && !person.phone) {
    throw new FieldReminderError(
      "RECIPIENT_PHONE_MISSING",
      `لا يوجد رقم واتساب مسجّل لـ${ROLE_LABEL[input.role]}.`,
    );
  }
  if (wantsWhatsapp && !isOpenWaConfigured()) {
    throw new FieldReminderError(
      "WHATSAPP_NOT_CONFIGURED",
      "واتساب غير متصل. أرسلي إشعار التطبيق أو راجعي حالة الاتصال.",
    );
  }

  const [push, whatsapp] = await Promise.all([
    wantsPush
      ? notifyFieldStaffReminder({
          orderId: order.id,
          role: input.role,
          rosterId,
          title: "تذكير من فريق كيارا",
          body: message,
        }).catch((error): FieldPushDeliverySummary => {
          console.error("[field-reminders] Push send failed", error);
          return {
            attempted: 1,
            accepted: 0,
            delivered: 0,
            pending: 0,
            failed: 1,
            errors: ["PUSH_SEND_FAILED"],
          };
        })
      : Promise.resolve(null),
    wantsWhatsapp && person.phone
      ? openWaTransport
          .sendText(person.phone, message)
          .then(() => ({ sent: true, error: null as string | null }))
          .catch((error) => ({
            sent: false,
            error:
              error instanceof Error
                ? error.message.slice(0, 300)
                : "OPENWA_SEND_FAILED",
          }))
      : Promise.resolve(null),
  ]);

  const delivered =
    (push ? push.accepted > 0 : false) || (whatsapp ? whatsapp.sent : false);
  const remindedAt = new Date().toISOString();

  // Only a reminder that actually left pushes the cron's window out. Recording
  // a failed attempt here would buy the machine 30 more minutes of silence on
  // an order nobody has been told about.
  if (delivered) {
    await getAdminSupabaseClient()
      .from("field_order_progress")
      .update({ last_reminder_at: remindedAt })
      .eq("order_id", order.id)
      .eq("restaurant_id", KIARA_RESTAURANT_ID);
  }

  await getAdminSupabaseClient()
    .from("operation_events")
    .insert({
      restaurant_id: KIARA_RESTAURANT_ID,
      aggregate_type: "driver_order",
      aggregate_id: order.id,
      event_type: "field.reminder_sent",
      actor_type: input.actor.teamMemberId ? "team_member" : "owner",
      actor_role: input.actor.role === "admin" ? "admin" : "agent",
      actor_user_id: input.actor.userId,
      actor_team_member_id: input.actor.teamMemberId,
      payload: {
        role: input.role,
        rosterId,
        channels: input.channels,
        pushAccepted: push?.accepted ?? 0,
        whatsappSent: whatsapp?.sent ?? false,
        messageLength: message.length,
      },
    })
    .then(
      () => undefined,
      (error) => {
        // The reminder is already out. An audit write that fails must not
        // report the send as failed.
        console.error("[field-reminders] Unable to record the audit event", error);
      },
    );

  return { role: input.role, remindedAt, push, whatsapp, delivered };
}
