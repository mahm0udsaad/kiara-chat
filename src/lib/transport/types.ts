/**
 * Transport abstraction.
 *
 * Kiara ran two transports at once until 2026-09-04: the salon's original
 * number (+966593695614) as a linked device driven by the OpenWA engine, and
 * +966508421748 as a Twilio sender on Meta's Business Platform. The linked
 * device is retired and the engine stopped; only Twilio sends now.
 *
 * The abstraction survives it. Callers still resolve a transport per
 * conversation (see ./index) rather than importing one directly, which is what
 * made removing a whole number a change to one file instead of thirty — and the
 * inbox and the data model still never see which one answered.
 */

/** "openwa" persists because stored rows carry it; nothing can send on it. */
export type TransportProvider = "openwa" | "twilio";

export interface SendResult {
  providerMessageId: string;
}

export interface OutboundMedia {
  /** Raw bytes, as the caller has them before anything is stored. */
  base64: string;
  contentType: string;
  filename?: string;
  caption?: string;
  /**
   * Send audio as a WhatsApp voice note rather than an audio file. Honoured
   * only by the linked device, which is retired: the Business Platform exposes
   * no PTT flag, so audio now always arrives as a file. Kept because callers
   * still express the intent and it costs nothing to carry.
   */
  ptt?: boolean;
  /**
   * Bucket path for media already stored in `whatsapp-media`. Twilio fetches
   * outbound media from a URL rather than accepting bytes, so its adapter signs
   * this path — which makes it required in practice, not optional.
   */
  storagePath?: string | null;
}

/** One value for a template's positional variables, keyed "1", "2", … */
export type TemplateVariables = Record<string, string>;

/**
 * Which of Kiara's own numbers a send goes out from.
 *
 * Passed per send rather than read from configuration, because the right answer
 * is already known: it is the number the customer actually wrote to, which the
 * provider told us on the way in and which is stored on the conversation. An
 * environment variable can drift from reality; the inbound message cannot.
 */
export interface SendOptions {
  from?: string | null;
}

export interface MessageTransport {
  readonly provider: TransportProvider;
  sendText(toE164: string, body: string, options?: SendOptions): Promise<SendResult>;
  sendMedia(
    toE164: string,
    media: OutboundMedia,
    options?: SendOptions,
  ): Promise<SendResult>;
  /**
   * Send a pre-approved template. Outside the 24-hour service window this is
   * the only thing Meta will deliver, so every proactive path needs one — and
   * since the linked device retired, every customer is behind that window until
   * she writes first.
   */
  sendTemplate(
    toE164: string,
    contentSid: string,
    variables: TemplateVariables,
    options?: SendOptions,
  ): Promise<SendResult>;
}

/**
 * WhatsApp's presence states, as Baileys reported them.
 *
 * Outlives the engine that produced them: `src/lib/presence.ts` still speaks
 * this vocabulary for the realtime typing channel between Kiara's own clients,
 * and the stored shape of past events uses these names.
 *
 * Nothing feeds it from WhatsApp any more. Presence was a linked-device
 * capability — WhatsApp pushes it to a paired client — and the Business
 * Platform exposes none, so no conversation shows a customer typing.
 */
export type WaPresence =
  | "unavailable"
  | "available"
  | "composing"
  | "recording"
  | "paused";
