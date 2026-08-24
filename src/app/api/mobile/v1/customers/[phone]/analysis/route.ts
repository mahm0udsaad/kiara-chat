import { canViewConversation } from "@/lib/conversation-meta";
import { analyzeCustomer } from "@/lib/customer-analysis";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";
import { normalizePhone } from "@/lib/phone";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import type { Conversation } from "@/lib/types";

/**
 * POST /api/mobile/v1/customers/:phone/analysis — the AI read of one
 * customer's experience, for the profile screen's «تحليل رضا العميلة» button.
 *
 * Same model call the web drawer on /orders makes, and the same shape, so the
 * two surfaces never disagree about a customer. On demand only: it costs a
 * model call, so nothing here runs on open.
 *
 * Authorization mirrors the timeline route beside it rather than the
 * order-scoped one: an employee may analyse a customer whose thread she is
 * allowed to see, and a thread routed to a colleague resolves to 404 — missing
 * and forbidden look identical, as everywhere else in v1.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ phone: string }> },
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  const { phone: raw } = await params;
  const phone = decodeURIComponent(raw ?? "");
  if (phone.replace(/\D/g, "").length < 8) {
    return mobileError(400, "INVALID_PHONE", "رقم غير صحيح");
  }

  try {
    const { data: conversation } = await getAdminSupabaseClient()
      .from("conversations")
      .select("id, metadata")
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      // Match the national part, as every other thread lookup does. The exact
      // comparison here compared `538948831` against a stored `+966538948831`,
      // so it resolved nothing and this routing check never once fired.
      .ilike("customer_phone", `%${normalizePhone(phone)}%`)
      .order("last_message_at", { ascending: false })
      .limit(1)
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
      return mobileError(404, "CUSTOMER_NOT_FOUND", "Customer not found");
    }

    const analysis = await analyzeCustomer(phone, {
      // Reuse the thread already resolved above so the analysis reads the same
      // conversation the authorization check just approved.
      ...(conversation?.id ? { conversationId: conversation.id as string } : {}),
    });

    if (!analysis) {
      return mobileError(
        422,
        "ANALYSIS_UNAVAILABLE",
        "التحليل غير متاح — لا توجد محادثة كافية أو لم تُفعّل خدمة الذكاء.",
      );
    }

    return mobileData({ analysis });
  } catch (error) {
    return mobileServerError(
      error,
      "CUSTOMER_ANALYSIS_FAILED",
      "تعذّر تحليل تجربة العميلة",
    );
  }
}
