import { canViewConversation } from "@/lib/conversation-meta";
import { analyzeCustomer } from "@/lib/customer-analysis";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";
import { getMobileOrderById } from "@/lib/mobile/orders";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import type { Conversation } from "@/lib/types";

export const maxDuration = 60;

/**
 * Analyze the conversation attached to an order.
 *
 * The order itself is shared work every employee may open and dispatch, but
 * this reads the customer's own thread — so it carries the same exclusive
 * routing rule as the customer-scoped analysis beside it, rather than becoming
 * the way around it. Nothing here is an arbitrary phone lookup either: the
 * phone comes from an order, never from the caller.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  const { id } = await params;
  try {
    const order = await getMobileOrderById(id, auth.session);
    if (!order) return mobileError(404, "ORDER_NOT_FOUND", "Order not found");

    const { data: conversation } = await getAdminSupabaseClient()
      .from("conversations")
      .select("id, metadata")
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .eq("id", order.conversation_id)
      .maybeSingle();
    if (
      conversation &&
      !canViewConversation(
        { metadata: conversation.metadata as Conversation["metadata"] },
        {
          isAdmin: auth.session.role === "admin",
          teamMemberId: auth.session.teamMemberId,
        },
      )
    ) {
      return mobileError(
        403,
        "CONVERSATION_ROUTED",
        "محادثة هذه العميلة موجّهة إلى موظفة أخرى — الطلب متاح لكِ، لكن التحليل لا.",
      );
    }

    const analysis = await analyzeCustomer(order.customer_phone, {
      conversationId: order.conversation_id,
    });
    if (!analysis) {
      return mobileError(
        422,
        "ANALYSIS_UNAVAILABLE",
        "التحليل غير متاح — لا توجد محادثة كافية أو لم تُفعّل خدمة الذكاء."
      );
    }

    return mobileData({ analysis });
  } catch (error) {
    return mobileServerError(
      error,
      "ORDER_ANALYSIS_FAILED",
      "تعذّر تحليل محادثة العميلة"
    );
  }
}
