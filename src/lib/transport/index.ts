import { isOpenWaConfigured, openWaTransport } from "./openwa";
import {
  getMetaSenderStatus,
  isMetaCloudConfigured,
  metaErrorCode,
  metaTransport,
} from "./meta";
import {
  getTwilioSenderStatus,
  isTwilioConfigured,
  twilioErrorCode,
  twilioTransport,
} from "./twilio";
import type { MessageTransport, TransportProvider } from "./types";

import { inboxProvider } from "./inbox-provider";
export { inboxProvider } from "./inbox-provider";

/** Business Platform provider for campaigns and approved template management. */
export function customerProvider(): Extract<TransportProvider, "twilio" | "meta"> {
  return process.env.WHATSAPP_CUSTOMER_PROVIDER?.trim().toLowerCase() === "meta"
    ? "meta"
    : "twilio";
}

/** Which number a *newly started* customer conversation belongs to. */
export function defaultOutboundProvider(): TransportProvider {
  return inboxProvider();
}

export function transportFor(provider: TransportProvider): MessageTransport {
  if (provider === "meta") return metaTransport;
  return provider === "twilio" ? twilioTransport : openWaTransport;
}

export function isProviderConfigured(provider: TransportProvider): boolean {
  if (provider === "meta") return isMetaCloudConfigured();
  return provider === "twilio" ? isTwilioConfigured() : isOpenWaConfigured();
}

/** Inbox routing follows the temporary switch, including existing threads. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function providerForConversation(conversationId: string): Promise<TransportProvider> {
  return inboxProvider();
}

/** The transport that carries a reply in a customer conversation. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function transportForConversation(conversationId: string): Promise<MessageTransport> {
  return transportFor(inboxProvider());
}

/**
 * Is there any way at all to send a customer reply right now? Used by the
 * composer gates, which only need to know whether to offer the channel.
 */
export function isAnyTransportConfigured(): boolean {
  return isProviderConfigured(inboxProvider());
}

export function transportErrorCode(error: unknown): string | null {
  return metaErrorCode(error) ?? twilioErrorCode(error);
}

export function getCustomerSenderStatus() {
  return customerProvider() === "meta"
    ? getMetaSenderStatus()
    : getTwilioSenderStatus();
}

export {
  openWaTransport,
  isOpenWaConfigured,
  metaTransport,
  isMetaCloudConfigured,
  twilioTransport,
  isTwilioConfigured,
};
export type { MessageTransport, TransportProvider };
