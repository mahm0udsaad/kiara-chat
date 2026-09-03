/**
 * Transport abstraction.
 *
 * Kiara now runs two transports at once, and that is deliberate rather than
 * transitional: the salon's original number (+966593695614) is a linked device
 * driven by the OpenWA engine, and the newer number (+966508421748) is a Twilio
 * WhatsApp sender on Meta's Business Platform. A number cannot be both, so the
 * two coexist and each conversation is answered on the number it arrived on.
 *
 * Callers therefore resolve a transport per conversation (see ./index) rather
 * than importing one directly. The inbox and the data model never see either.
 */

export type TransportProvider = "openwa" | "twilio";

export interface SendResult {
  providerMessageId: string;
}

export interface OutboundMedia {
  /** Raw bytes. OpenWA sends these directly; Twilio uploads them first. */
  base64: string;
  contentType: string;
  filename?: string;
  caption?: string;
  /**
   * Send audio as a WhatsApp voice note rather than an audio file. OpenWA only:
   * the Business Platform exposes no PTT flag, so Twilio sends plain audio.
   */
  ptt?: boolean;
  /**
   * Bucket path for media already stored in `whatsapp-media`. Twilio fetches
   * outbound media from a URL rather than accepting bytes, so its adapter signs
   * this path; OpenWA ignores it and uses `base64`.
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
   * the only thing Meta will deliver, so every proactive path needs one.
   * OpenWA has no such concept and sends the rendered text instead.
   */
  sendTemplate(
    toE164: string,
    contentSid: string,
    variables: TemplateVariables,
    options?: SendOptions,
  ): Promise<SendResult>;
}

/** Media as a transport delivers it to the ingest webhook. */
export interface InboundMediaBlob {
  base64: string;
  contentType: string;
  filename?: string | null;
}

/** A live inbound (or fromMe) message pushed by the OpenWA service. */
export interface OpenWaMessageEvent {
  type: "message";
  waMessageId: string;
  fromMe: boolean;
  /**
   * E.164. Null when WhatsApp addressed the chat only by its anonymized `@lid`
   * and the engine could not map it back — which happens on replies sent from
   * the phone app. `chatLid` identifies the chat in that case.
   */
  customerPhone: string | null;
  /**
   * The chat's anonymized `@lid` id, whenever WhatsApp used one. Bound to the
   * conversation the first time it arrives with a resolvable phone, so later
   * lid-only messages still land in the right thread.
   */
  chatLid?: string | null;
  /**
   * A group chat's jid (`…@g.us`). Present only on group messages; when it is
   * set, `customerPhone` is the *participant* who spoke, not the chat.
   */
  chatJid?: string | null;
  /** The group's title, so the thread can be listed by name. */
  groupSubject?: string | null;
  /** Who spoke inside the group — WhatsApp `pushName`. Inbound only. */
  participantName?: string | null;
  timestamp?: number; // unix seconds
  messageType: string; // text | image | audio | voice | video | document | file
  body: string;
  /**
   * The sender's WhatsApp display name (Baileys `pushName`). Inbound only — on a
   * fromMe message this is Kiara's own account name, so the engine sends null.
   * Optional: older engine builds don't send it at all.
   */
  customerName?: string | null;
  media?: InboundMediaBlob[];
}

/** A delivery/read acknowledgement pushed by the OpenWA service. */
export interface OpenWaAckEvent {
  type: "ack";
  waMessageId: string;
  status: "sent" | "delivered" | "read" | "failed";
}

/** WhatsApp's presence states, as Baileys reports them. */
export type WaPresence =
  | "unavailable"
  | "available"
  | "composing"
  | "recording"
  | "paused";

/**
 * The customer started (or stopped) typing. Never stored — it is true for a
 * couple of seconds and would churn the conversations table for nothing.
 *
 * OpenWA only. The Business Platform exposes no inbound presence at all, so
 * conversations on the Twilio number never show a typing indicator.
 */
export interface OpenWaPresenceEvent {
  type: "presence";
  customerPhone: string | null;
  chatLid?: string | null;
  state: WaPresence;
}

export type OpenWaEvent = OpenWaMessageEvent | OpenWaAckEvent | OpenWaPresenceEvent;
