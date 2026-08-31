import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";
import { normalizePhone } from "@/lib/phone";
import { findOrCreateConversation } from "@/lib/server-conversations";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/v1/conversations/by-phone — the in-app thread for a number.
 *
 * The order screens used to hand an employee off to WhatsApp to message a
 * driver or a specialist, which sends it from her personal account: a
 * different sender, and a reply nobody else on the team can see. To reply as
 * the salon she needs the thread inside the app, and that thread is addressed
 * by phone — the roster knows numbers, not conversation ids.
 *
 * Creates one when the person has never written in. That is the same thing the
 * schedule already does when it raises an order for a customer with no chat:
 * an empty thread is how the salon writes first.
 */
export async function POST(request: Request) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => null)) as {
    phone?: unknown;
    name?: unknown;
  } | null;
  const raw = typeof body?.phone === "string" ? body.phone.trim() : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!raw) return mobileError(400, "PHONE_REQUIRED", "phone is required");

  // The stored column is +E.164 while a roster row can hold anything the salon
  // typed. Matching on the national part is what the Rekaz booking path
  // already does, and an exact comparison here would miss every thread.
  const national = normalizePhone(raw);
  if (!national) return mobileError(400, "PHONE_INVALID", "phone is invalid");

  try {
    const { data: existing } = await getAdminSupabaseClient()
      .from("conversations")
      .select("id")
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .ilike("customer_phone", `%${national}%`)
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing?.id) {
      return mobileData({ conversationId: existing.id as string, created: false });
    }

    const digits = raw.replace(/\D/g, "");
    const created = await findOrCreateConversation(`+${digits}`, name || null);
    return mobileData({ conversationId: created.id, created: created.is_new });
  } catch (error) {
    return mobileServerError(
      error,
      "CONVERSATION_LOOKUP_FAILED",
      "تعذّر فتح المحادثة",
    );
  }
}
