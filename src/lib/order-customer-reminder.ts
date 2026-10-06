import "server-only";

import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import { customerProvider, getCustomerSenderStatus, isProviderConfigured, transportErrorCode, transportFor } from "@/lib/transport";
import { getServiceWindow } from "@/lib/transport/window";
import { listTemplatesWithStatus } from "@/lib/transport/content";
import { contentSidFor, templateSpec } from "@/lib/templates";

export const ORDER_CUSTOMER_REMINDER_KEY = "specialist_en_route_reminder" as const;
export const ORDER_CUSTOMER_REMINDER_BODY = templateSpec(ORDER_CUSTOMER_REMINDER_KEY).body;

export type OrderCustomerReminderStatus = "ready" | "sending" | "sent" | "failed" | "uncertain";

export class OrderCustomerReminderError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message);
    this.name = "OrderCustomerReminderError";
  }
}

const sentStatuses = new Set(["sent", "delivered", "read"]);

function reminderStatus(deliveryStatus: string | null | undefined): OrderCustomerReminderStatus {
  if (!deliveryStatus) return "ready";
  if (sentStatuses.has(deliveryStatus)) return "sent";
  if (deliveryStatus === "failed" || deliveryStatus === "undelivered") return "failed";
  if (deliveryStatus === "uncertain") return "uncertain";
  return "sending";
}

async function reminderMessage(orderId: string, conversationId: string) {
  const { data, error } = await getAdminSupabaseClient()
    .from("messages")
    .select("id, delivery_status, external_message_sid, content, metadata")
    .eq("conversation_id", conversationId)
    .eq("client_request_id", orderId)
    .maybeSingle();
  if (error) throw error;
  return data && (data.metadata as Record<string, unknown> | null)?.source === "order_customer_reminder"
    ? data
    : null;
}

export async function getOrderCustomerReminder(orderId: string, conversationId: string) {
  const message = await reminderMessage(orderId, conversationId);
  return {
    body: ORDER_CUSTOMER_REMINDER_BODY,
    status: reminderStatus(message?.delivery_status as string | null | undefined),
    sentAt: ((message?.metadata as Record<string, unknown> | null)?.sent_at as string | undefined) ?? null,
  };
}

async function approvedReminderSid(): Promise<string> {
  const sid = contentSidFor(ORDER_CUSTOMER_REMINDER_KEY);
  if (!sid) throw new OrderCustomerReminderError("REMINDER_NOT_CONFIGURED", "قالب تذكير العميلة غير مهيأ بعد.", 503);
  let templates;
  try {
    templates = await listTemplatesWithStatus();
  } catch {
    throw new OrderCustomerReminderError("REMINDER_APPROVAL_UNAVAILABLE", "تعذّر التحقق من اعتماد قالب التذكير حاليًا.", 503);
  }
  const template = templates.find((candidate) => candidate.sid === sid);
  if (template?.status !== "approved" || template.body !== ORDER_CUSTOMER_REMINDER_BODY) {
    throw new OrderCustomerReminderError("REMINDER_NOT_APPROVED", "قالب تذكير العميلة لم يُعتمد بعد في واتساب.", 409);
  }
  return sid;
}

export async function sendOrderCustomerReminder(input: {
  orderId: string;
  conversationId: string;
  customerPhone: string;
  body: string;
  senderEmail: string | null;
  senderTeamMemberId: string | null;
}) {
  const body = input.body.trim();
  if (!body || body.length > 4096) {
    throw new OrderCustomerReminderError("INVALID_REMINDER", "اكتبي نص التذكير (٤٠٩٦ حرفًا كحد أقصى).");
  }

  const provider = customerProvider();
  if (!isProviderConfigured(provider)) {
    throw new OrderCustomerReminderError("SENDER_NOT_CONFIGURED", "رقم واتساب الأعمال غير مهيأ للإرسال.", 503);
  }
  const usesTemplate = body === ORDER_CUSTOMER_REMINDER_BODY;
  const sid = usesTemplate ? await approvedReminderSid() : null;
  if (!usesTemplate && !(await getServiceWindow(input.conversationId)).open) {
    throw new OrderCustomerReminderError(
      "REMINDER_EDIT_OUTSIDE_WINDOW",
      "يمكن تعديل نص التذكير فقط خلال ٢٤ ساعة من آخر رسالة للعميلة. استخدمي النص المعتمد للإرسال الآن.",
      409,
    );
  }

  const admin = getAdminSupabaseClient();
  const metadata = {
    source: "order_customer_reminder",
    order_id: input.orderId,
    sent_by_email: input.senderEmail,
    ...(sid ? { template: { key: ORDER_CUSTOMER_REMINDER_KEY, contentSid: sid, variables: {}, buttons: [] } } : {}),
  };

  // The existing unique (conversation_id, client_request_id) index claims this
  // order before any provider call. A second employee cannot send it twice.
  const inserted = await admin.from("messages").insert({
    conversation_id: input.conversationId,
    role: "agent",
    content: body,
    message_type: "text",
    metadata,
    sender_team_member_id: input.senderTeamMemberId,
    channel: "whatsapp",
    delivery_status: "queued",
    client_request_id: input.orderId,
  }).select("id").single();

  let messageId: string | null = inserted.data?.id ?? null;
  if (inserted.error?.code === "23505") {
    const previous = await reminderMessage(input.orderId, input.conversationId);
    if (!previous) throw new OrderCustomerReminderError("REMINDER_CONFLICT", "تعذّر التحقق من التذكير السابق.", 409);
    if (reminderStatus(previous.delivery_status) !== "failed") {
      throw new OrderCustomerReminderError("REMINDER_ALREADY_SENT", "أُرسل تذكير لهذه العميلة بالفعل أو يجري إرساله.", 409);
    }
    const retried = await admin.from("messages")
      .update({
        content: body,
        metadata,
        delivery_status: "queued",
        external_message_sid: null,
        twilio_message_sid: null,
        error_message: null,
        external_error_code: null,
      })
      .eq("id", previous.id)
      .eq("delivery_status", previous.delivery_status)
      .select("id")
      .maybeSingle();
    if (retried.error) throw retried.error;
    if (!retried.data) throw new OrderCustomerReminderError("REMINDER_ALREADY_SENT", "يجري إرسال التذكير من جهاز آخر.", 409);
    messageId = retried.data.id;
  } else if (inserted.error) {
    throw inserted.error;
  }
  if (!messageId) throw new Error("Reminder message was not recorded");

  const transport = transportFor(provider);
  let providerId: string | null = null;
  try {
    const result = sid
      ? await transport.sendTemplate(input.customerPhone, sid, {})
      : await transport.sendText(input.customerPhone, body);
    providerId = result.providerMessageId;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // A timeout may have happened after the provider accepted the request.
    // Hold that state for investigation rather than offer a duplicate send.
    const uncertain = /timeout|timed out|unreachable|network|fetch failed|abort/i.test(reason);
    await admin.from("messages").update({
      delivery_status: uncertain ? "uncertain" : "failed",
      error_message: reason.slice(0, 500),
      external_error_code: transportErrorCode(error),
    }).eq("id", messageId);
    throw new OrderCustomerReminderError(
      uncertain ? "REMINDER_SEND_UNCERTAIN" : "REMINDER_SEND_FAILED",
      uncertain ? "تعذّر تأكيد الإرسال. تحققي من المحادثة قبل المحاولة مجددًا." : "تعذّر إرسال التذكير. حاولي مرة أخرى.",
      502,
    );
  }

  const sentAt = new Date().toISOString();
  const senderNumber = getCustomerSenderStatus().number;
  const [{ error: messageError }, { data: conversation }] = await Promise.all([
    admin.from("messages").update({
      delivery_status: "sent",
      external_message_sid: providerId,
      ...(provider === "twilio" ? { twilio_message_sid: providerId } : {}),
      metadata: { ...metadata, sent_at: sentAt },
    }).eq("id", messageId),
    admin.from("conversations").select("metadata").eq("id", input.conversationId).eq("restaurant_id", KIARA_RESTAURANT_ID).maybeSingle(),
  ]);
  if (messageError) throw messageError;
  const conversationMeta = (conversation?.metadata as Record<string, unknown> | null) ?? {};
  await admin.from("conversations").update({
    last_message_at: sentAt,
    metadata: { ...conversationMeta, transport: provider, ...(senderNumber ? { wa_number: senderNumber } : {}) },
  }).eq("id", input.conversationId).eq("restaurant_id", KIARA_RESTAURANT_ID);
  return { messageId, sentAt };
}
