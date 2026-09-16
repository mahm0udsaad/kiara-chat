import type { TransportProvider } from "./types";

/**
 * Inbox provider. Staff order notifications use OpenWA directly and are
 * independent from this customer-conversation setting.
 */
export function inboxProvider(): TransportProvider {
  const provider = process.env.WHATSAPP_INBOX_PROVIDER?.trim().toLowerCase();
  if (!provider) return "twilio";
  if (provider === "openwa" || provider === "twilio" || provider === "meta") {
    return provider;
  }
  throw new Error("WHATSAPP_INBOX_PROVIDER must be openwa, twilio, or meta");
}
