/**
 * Transport abstraction. Kiara runs on OpenWA now; a Twilio adapter can be
 * dropped in later behind this same interface if the number ever needs to
 * move to the official API. The inbox/data model never sees the transport.
 */

export interface SendResult {
  providerMessageId: string;
}

export interface MessageTransport {
  sendText(toE164: string, body: string): Promise<SendResult>;
  sendMedia(
    toE164: string,
    media: {
      base64: string;
      contentType: string;
      filename?: string;
      caption?: string;
      /** Send audio as a WhatsApp voice note rather than an audio file. */
      ptt?: boolean;
    }
  ): Promise<SendResult>;
}

/** Media as the OpenWA service delivers it to the ingest webhook. */
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

export type OpenWaEvent = OpenWaMessageEvent | OpenWaAckEvent;
