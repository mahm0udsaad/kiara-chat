import { canViewConversation } from "@/lib/conversation-meta";
import { getCustomerTimeline } from "@/lib/customer-timeline";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { normalizePhone } from "@/lib/phone";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import type { Conversation } from "@/lib/types";

/**
 * GET /api/mobile/v1/customers/:phone/timeline — the same customer record the
 * web drawer on /orders shows, for the mobile profile screen.
 *
 * The read model is `getCustomerTimeline`, shared verbatim with the web route:
 * Rekaz lifetime bookings and revenue stitched onto this app's conversation,
 * messages, orders and notes, keyed on the normalized phone.
 *
 * Authorization is stricter than the web route on purpose. The web dashboard
 * lets any signed-in employee open any customer; the mobile v1 contract keeps
 * the inbox's exclusive routing, so a phone whose conversation is routed to
 * another employee resolves to 404 here — the same "missing and forbidden look
 * identical" rule the order endpoints follow.
 */
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(
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
    // Check routing before assembling anything: the timeline makes a live
    // lifetime call to Rekaz, and an employee who may not see this customer
    // should not be able to trigger it.
    const { data: conversation } = await getAdminSupabaseClient()
      .from("conversations")
      .select("id, metadata")
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .eq("customer_phone", normalizePhone(phone))
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

    // No conversation at all means there is no routed thread to protect — the
    // remaining data is the salon's own Rekaz booking history.
    const timeline = await getCustomerTimeline(phone);
    return mobileData(timeline);
  } catch (error) {
    return mobileServerError(
      error,
      "CUSTOMER_TIMELINE_FAILED",
      "تعذّر تحميل سجل العميلة",
    );
  }
}
