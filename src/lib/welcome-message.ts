/**
 * The fixed welcome menu sent to a customer who starts a chat.
 *
 * "Starts a chat" means her message is the first one in the thread for
 * `WELCOME_QUIET_DAYS` — a number we have never heard from, or one that has
 * been silent long enough that the menu is useful again. A customer with a
 * Rekaz booking in that window (or still ahead) is already being looked after,
 * so she is skipped.
 *
 * The settings live in `restaurants.metadata.welcome`, next to the campaign
 * list, so the owner can change the wording or switch it off without a
 * release. Off until she turns it on.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import { isProviderConfigured, transportForConversation } from "@/lib/transport";
import { bumpConversationActivity, saveMessage } from "@/lib/server-conversations";

export const WELCOME_QUIET_DAYS = 60;

export const DEFAULT_WELCOME_TEXT = `🌸 أهلًا وسهلًا بك في كيارا سبا 🤍
يسعدنا خدمتك، اختاري الرقم المناسب لطلبك حتى نساعدك بكل سهولة:

1️⃣ للاستفسار عن الأسعار والعروض والخدمات
تصفحي قائمة خدماتنا وأسعارنا وعروضنا من هنا: https://rekaz.io/kyara-sba-1

2️⃣ للحجوزات
للحجز عن طريق فريق كيارا، أرسلي لنا:
* الاسم.
* الخدمة المطلوبة والمدة.
* اليوم والتاريخ والوقت المناسب.
* الحي أو المنطقة.
* عدد الأشخاص.

3️⃣ للحجز عن طريق الاتصال أو للاستفسار 📞
تواصلي معنا على الرقم: 0508421748

4️⃣ للحجز عن طريق تمارا أو تابي، أو لطلب هدية 🎁
اختاري الرقم 4 لتحديد طلبك والحصول على المزيد من المساعدة.

🤍 كيارا سبا | عناية صغيرة… فرق كبير 🌷`;

export interface WelcomeSettings {
  enabled: boolean;
  text: string;
}

async function readMetadata(): Promise<Record<string, unknown>> {
  const { data, error } = await getAdminSupabaseClient()
    .from("restaurants")
    .select("metadata")
    .eq("id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.metadata as Record<string, unknown> | null) ?? {};
}

export async function getWelcomeSettings(): Promise<WelcomeSettings> {
  const stored = (await readMetadata()).welcome as Partial<WelcomeSettings> | undefined;
  return {
    enabled: stored?.enabled === true,
    text: typeof stored?.text === "string" && stored.text.trim() ? stored.text : DEFAULT_WELCOME_TEXT,
  };
}

export async function saveWelcomeSettings(next: WelcomeSettings): Promise<WelcomeSettings> {
  const meta = await readMetadata();
  const welcome = { enabled: next.enabled, text: next.text.trim() };
  const { error } = await getAdminSupabaseClient()
    .from("restaurants")
    .update({ metadata: { ...meta, welcome } })
    .eq("id", KIARA_RESTAURANT_ID);
  if (error) throw new Error(error.message);
  return welcome;
}

export type WelcomeOutcome =
  | "sent"
  | "off"
  | "not_first"
  | "has_booking"
  | "no_transport"
  | "error";

/**
 * Send the welcome if `messageId` (the customer's message, already saved) is
 * the first message in its thread for `WELCOME_QUIET_DAYS`.
 *
 * "First" is decided by ordering the window's messages, not by reading
 * `last_message_at`: two messages arriving together both see a stale
 * timestamp, but only one of them can be first in the list. A welcome or a
 * staff reply sits in that list too, so the next message is never first.
 *
 * Never throws into the webhook — a failed welcome must not cost us the
 * customer's message.
 */
export async function sendWelcomeIfDue(input: {
  conversationId: string;
  customerPhone: string;
  messageId: string;
  receivedAt?: string;
}): Promise<WelcomeOutcome> {
  try {
    const settings = await getWelcomeSettings();
    if (!settings.enabled || !settings.text.trim()) return "off";

    const receivedMs = input.receivedAt ? Date.parse(input.receivedAt) : Date.now();
    const cutoff = new Date(receivedMs - WELCOME_QUIET_DAYS * 86_400_000).toISOString();
    const admin = getAdminSupabaseClient();

    const { data: first, error: firstError } = await admin
      .from("messages")
      .select("id")
      .eq("conversation_id", input.conversationId)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (firstError) throw new Error(firstError.message);
    if (first?.id !== input.messageId) return "not_first";

    // Rekaz is mirrored here from 21 Aug 2026, which covers the whole window.
    const { data: booking, error: bookingError } = await admin
      .from("rekaz_reservations")
      .select("source_id")
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .eq("customer_phone", input.customerPhone)
      .is("removed_at", null)
      .gte("arrival_at", cutoff)
      .limit(1)
      .maybeSingle();
    if (bookingError) throw new Error(bookingError.message);
    if (booking) return "has_booking";

    const transport = await transportForConversation(input.conversationId);
    if (!isProviderConfigured(transport.provider)) return "no_transport";

    const { providerMessageId } = await transport.sendText(input.customerPhone, settings.text);
    await saveMessage({
      conversationId: input.conversationId,
      role: "agent",
      content: settings.text,
      messageType: "text",
      externalMessageSid: providerMessageId,
      ...(transport.provider === "twilio" ? { twilioMessageSid: providerMessageId } : {}),
      metadata: { source: "welcome", provider: transport.provider },
      deliveryStatus: "sent",
    });
    await bumpConversationActivity(input.conversationId, { inbound: false });
    return "sent";
  } catch (e) {
    console.error("[welcome] failed", e instanceof Error ? e.message : e);
    return "error";
  }
}
