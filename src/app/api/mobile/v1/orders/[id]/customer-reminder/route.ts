import { getMobileOrderById } from "@/lib/mobile/orders";
import { replyDenialFor } from "@/lib/conversation-reply-access";
import { getConversationById } from "@/lib/inbox";
import {
  getOrderCustomerReminder,
  ORDER_CUSTOMER_REMINDER_BODY,
  OrderCustomerReminderError,
  sendOrderCustomerReminder,
} from "@/lib/order-customer-reminder";
import { authorizeMobileRequest, mobileData, mobileError, mobileServerError } from "@/lib/mobile/http";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;
  const { id } = await params;
  try {
    const order = await getMobileOrderById(id, auth.session);
    if (!order) return mobileError(404, "ORDER_NOT_FOUND", "الطلب غير موجود.");
    return mobileData({ reminder: await getOrderCustomerReminder(id, order.conversation_id) });
  } catch (error) {
    return mobileServerError(error, "CUSTOMER_REMINDER_FAILED", "تعذّر تحميل حالة تذكير العميلة.");
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;
  const payload: unknown = await request.json().catch(() => null);
  const body = payload && typeof payload === "object" && "body" in payload
    ? (payload as { body?: unknown }).body
    : null;
  if (typeof body !== "string" || !body.trim()) {
    return mobileError(400, "REMINDER_BODY_REQUIRED", "نص تذكير العميلة مطلوب.");
  }
  const { id } = await params;
  try {
    const order = await getMobileOrderById(id, auth.session);
    if (!order) return mobileError(404, "ORDER_NOT_FOUND", "الطلب غير موجود.");
    if (order.status !== "sent" || !order.specialist_id) {
      return mobileError(409, "ORDER_NOT_DISPATCHED", "أرسلي الطلب للأخصائية أولًا قبل تذكير العميلة بأنها في الطريق.");
    }
    if (body.trim() !== ORDER_CUSTOMER_REMINDER_BODY) {
      const conversation = await getConversationById(order.conversation_id, {
        isAdmin: auth.session.role === "admin",
        teamMemberId: auth.session.teamMemberId,
      });
      if (!conversation) return mobileError(404, "CONVERSATION_NOT_FOUND", "المحادثة غير موجودة.");
      const denial = replyDenialFor(conversation, {
        role: auth.session.role,
        teamMemberId: auth.session.teamMemberId,
      });
      if (denial) return mobileError(denial.status, denial.code, denial.message);
    }
    const sent = await sendOrderCustomerReminder({
      orderId: id,
      conversationId: order.conversation_id,
      customerPhone: order.customer_phone,
      body,
      senderEmail: auth.session.email,
      senderTeamMemberId: auth.session.teamMemberId,
    });
    return mobileData({ reminder: await getOrderCustomerReminder(id, order.conversation_id), ...sent });
  } catch (error) {
    if (error instanceof OrderCustomerReminderError) {
      return mobileError(error.status, error.code, error.message);
    }
    return mobileServerError(error, "CUSTOMER_REMINDER_SEND_FAILED", "تعذّر إرسال تذكير العميلة.");
  }
}
