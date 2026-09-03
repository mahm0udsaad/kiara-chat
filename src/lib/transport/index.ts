import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { isOpenWaConfigured, openWaTransport } from "./openwa";
import { isTwilioConfigured, twilioTransport } from "./twilio";
import type { MessageTransport, TransportProvider } from "./types";

/**
 * Which transport answers a given conversation.
 *
 * Kiara runs two WhatsApp numbers at once and they are not interchangeable: a
 * customer who wrote to the linked device must be answered from the linked
 * device, and one who wrote to the Business Platform sender must be answered
 * from that sender. Replying on the wrong number would reach her as a message
 * from a stranger.
 *
 * So the provider is a property of the conversation, recorded when a message
 * arrives, rather than a deployment-wide switch. Conversations that predate
 * Twilio carry no marker at all, which is exactly right — they resolve to
 * OpenWA and keep behaving as they always have.
 */
const DEFAULT_PROVIDER: TransportProvider = "openwa";

/**
 * Which number a *newly started* conversation belongs to.
 *
 * Only for threads the team opens themselves — from a reservation, from the
 * mobile app by phone, or from a dispatch — where no inbound message has said
 * which number the customer used. Since +966508421748 is now the operational
 * number, those go to Twilio.
 *
 * This deliberately does not touch conversations that already exist. A customer
 * with history on the linked-device number must keep being answered there: she
 * wrote to that number, and a reply from a different one arrives as a message
 * from a stranger.
 */
export function defaultOutboundProvider(): TransportProvider {
  const configured = process.env.WHATSAPP_DEFAULT_PROVIDER?.trim().toLowerCase();
  if (configured === "openwa") return "openwa";
  if (configured === "twilio") return "twilio";
  // Unset: prefer the Business Platform once it is actually usable.
  return isTwilioConfigured() ? "twilio" : "openwa";
}

export function transportFor(provider: TransportProvider): MessageTransport {
  return provider === "twilio" ? twilioTransport : openWaTransport;
}

export function isProviderConfigured(provider: TransportProvider): boolean {
  return provider === "twilio" ? isTwilioConfigured() : isOpenWaConfigured();
}

/** Read the provider recorded on a conversation. Unmarked threads are OpenWA. */
export async function providerForConversation(
  conversationId: string,
): Promise<TransportProvider> {
  const { data } = await getAdminSupabaseClient()
    .from("conversations")
    .select("metadata")
    .eq("id", conversationId)
    .maybeSingle();
  const metadata = (data?.metadata as Record<string, unknown> | null) ?? {};
  return metadata.transport === "twilio" ? "twilio" : DEFAULT_PROVIDER;
}

/** The transport that should carry a reply in this conversation. */
export async function transportForConversation(
  conversationId: string,
): Promise<MessageTransport> {
  return transportFor(await providerForConversation(conversationId));
}

/**
 * Is there any way at all to send right now? Used by the composer gates, which
 * only need to know whether to offer the channel — not which pipe it uses.
 */
export function isAnyTransportConfigured(): boolean {
  return isOpenWaConfigured() || isTwilioConfigured();
}

export { openWaTransport, isOpenWaConfigured, twilioTransport, isTwilioConfigured };
export type { MessageTransport, TransportProvider };
