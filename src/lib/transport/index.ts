import { isOpenWaConfigured, openWaTransport } from "./openwa";
import { isTwilioConfigured, twilioTransport } from "./twilio";
import type { MessageTransport, TransportProvider } from "./types";

/**
 * Which transport does what — the split that survived the 2026-09-04 rework.
 *
 * Two numbers, two jobs. They are no longer interchangeable, and per-conversation
 * routing is deliberately gone — a customer thread is a Twilio thread, full stop.
 *
 * - **+966508421748 — Twilio**, on Meta's Business Platform. Every customer
 *   conversation lives here: inbound, agent replies, and the approved templates
 *   that open a chat outside the 24-hour window.
 *   `transportForConversation()` always resolves here.
 *
 * - **+966595532435 — OpenWA linked device** on the VPS. Staff-only outbound.
 *   Dispatch notes to drivers and specialists, field reminders, voice notes and
 *   door photos. Reached by calling `openWaTransport` directly from the staff
 *   paths — never through `transportForConversation`, because staff are not
 *   customer conversations. Callers still gate on `isOpenWaConfigured()` so a
 *   disconnected engine degrades to a push-only nudge instead of throwing.
 *
 * `TransportProvider` keeps its `"openwa"` member because history still has
 * rows tagged that way; nothing new gets that value.
 */
const ONLY_CUSTOMER_PROVIDER: TransportProvider = "twilio";

/** Which number a *newly started* customer conversation belongs to. */
export function defaultOutboundProvider(): TransportProvider {
  return ONLY_CUSTOMER_PROVIDER;
}

export function transportFor(provider: TransportProvider): MessageTransport {
  return provider === "twilio" ? twilioTransport : openWaTransport;
}

export function isProviderConfigured(provider: TransportProvider): boolean {
  return provider === "twilio" ? isTwilioConfigured() : isOpenWaConfigured();
}

/**
 * Read the provider for a customer conversation. Always Twilio now.
 *
 * Deliberately no longer consults `conversations.metadata.transport`. That
 * marker records which number a customer *used to* write to, and half of the
 * pre-Twilio threads say `"openwa"` — honouring it would route her reply into
 * a number that is now staff-outbound and cannot address her at all.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function providerForConversation(conversationId: string): Promise<TransportProvider> {
  return ONLY_CUSTOMER_PROVIDER;
}

/** The transport that carries a reply in a customer conversation. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function transportForConversation(conversationId: string): Promise<MessageTransport> {
  return twilioTransport;
}

/**
 * Is there any way at all to send a customer reply right now? Used by the
 * composer gates, which only need to know whether to offer the channel.
 * OpenWA does not count here — it never talks to customers.
 */
export function isAnyTransportConfigured(): boolean {
  return isTwilioConfigured();
}

export { openWaTransport, isOpenWaConfigured, twilioTransport, isTwilioConfigured };
export type { MessageTransport, TransportProvider };
