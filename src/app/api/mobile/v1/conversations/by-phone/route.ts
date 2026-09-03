import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";
import { canonicalPhone, normalizePhone } from "@/lib/phone";
import {
  findOrCreateConversation,
  rememberConversationTransport,
} from "@/lib/server-conversations";
import { defaultOutboundProvider } from "@/lib/transport";
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
  const canonical = canonicalPhone(raw);
  if (!canonical || national.length < 8) {
    return mobileError(400, "PHONE_INVALID", "phone is invalid");
  }

  try {
    const admin = getAdminSupabaseClient();
    const { data: exact, error: exactError } = await admin
      .from("conversations")
      .select("id")
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .eq("customer_phone", canonical)
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (exactError) throw new Error(exactError.message);
    const { data: legacy, error: legacyError } = exact
      ? { data: null, error: null }
      : await admin
          .from("conversations")
          .select("id, customer_phone")
          .eq("restaurant_id", KIARA_RESTAURANT_ID)
          // Compatibility for old rows stored with punctuation or a trunk 0.
          // The full-number minimum above prevents a short suffix collision.
          .ilike("customer_phone", `%${national}`)
          .order("last_message_at", { ascending: false })
          .limit(1)
          .maybeSingle();
    if (legacyError) throw new Error(legacyError.message);
    const existing = exact ?? legacy;
    if (existing?.id) {
      // Repair old `+05…`/punctuated rows when they are encountered. An exact
      // canonical row was checked first, so this cannot collide with it.
      if (legacy && legacy.customer_phone !== canonical) {
        const { error: repairError } = await admin
          .from("conversations")
          .update({ customer_phone: canonical })
          .eq("id", legacy.id);
        if (repairError) throw new Error(repairError.message);
      }
      return mobileData({ conversationId: existing.id as string, created: false });
    }

    const created = await findOrCreateConversation(canonical, name || null);
    // A thread the team opened has no inbound to say which number the customer
    // used, so it belongs to whichever number Kiara operates on now.
    if (created.is_new) {
      await rememberConversationTransport(created.id, defaultOutboundProvider());
    }
    return mobileData({ conversationId: created.id, created: created.is_new });
  } catch (error) {
    return mobileServerError(
      error,
      "CONVERSATION_LOOKUP_FAILED",
      "تعذّر فتح المحادثة",
    );
  }
}
