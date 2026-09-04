import { isTwilioConfigured, twilioTransport } from "./twilio";
import type { MessageTransport, TransportProvider } from "./types";

/**
 * Which transport answers a given conversation. There is now only one.
 *
 * Kiara ran two WhatsApp numbers side by side until 2026-09-04: the salon's
 * original +966593695614 as a linked device driven by the OpenWA engine, and
 * +966508421748 as a Twilio sender on Meta's Business Platform. The linked
 * device is retired — its session died on 2026-09-03 and was never re-paired,
 * and the engine has been stopped. Everything leaves on the Business number.
 *
 * `TransportProvider` keeps its "openwa" member because the *data* still has
 * it: 293 conversations carry no transport marker and most of the message
 * history was captured through the engine. Reading those rows must keep
 * working. Sending through it must not, which is why nothing here can hand back
 * an OpenWA transport any more.
 *
 * These functions kept their signatures rather than being inlined away. They
 * are the reason retiring a whole number was a small change, and the questions
 * they answer — "where does this reply go?", "can we send at all?" — stay
 * worth asking in one place if a second number is ever added back.
 */
const ONLY_PROVIDER: TransportProvider = "twilio";

/** Which number a conversation belongs to. One number, so one answer. */
export function defaultOutboundProvider(): TransportProvider {
  return ONLY_PROVIDER;
}

export function isProviderConfigured(provider: TransportProvider): boolean {
  return provider === "twilio" ? isTwilioConfigured() : false;
}

/**
 * Read the provider for a conversation.
 *
 * Deliberately no longer reads `metadata.transport`. That marker records which
 * number a customer *used to* write to, and half of them say "openwa" — a
 * number that can no longer send. Honouring it would route her reply into a
 * dead pipe. Old threads are answered from the Business number now, which is
 * what the `kiara_conversation_opener` template exists to explain to a customer
 * who has never seen that number before.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function providerForConversation(conversationId: string): Promise<TransportProvider> {
  return ONLY_PROVIDER;
}

/** The transport that should carry a reply in this conversation. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function transportForConversation(conversationId: string): Promise<MessageTransport> {
  return twilioTransport;
}

/**
 * Is there any way at all to send right now? Used by the composer gates, which
 * only need to know whether to offer the channel — not which pipe it uses.
 */
export function isAnyTransportConfigured(): boolean {
  return isTwilioConfigured();
}

export { twilioTransport, isTwilioConfigured };
export type { MessageTransport, TransportProvider };
