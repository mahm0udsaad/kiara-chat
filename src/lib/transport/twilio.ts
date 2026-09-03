import type {
  MessageTransport,
  OutboundMedia,
  SendResult,
  TemplateVariables,
} from "./types";
import { signMediaUrl } from "@/lib/storage-media";

/**
 * Twilio transport — the WhatsApp Business Platform sender (+966508421748).
 *
 * Unlike the OpenWA engine this talks to a hosted API rather than a machine we
 * run, so the failure modes are different: no socket to fall out of, but hard
 * rules about what may be sent and when. Two of those shape this file —
 * free-form text is only deliverable inside 24 hours of the customer's last
 * message, and outbound media must be fetched by Twilio from a URL rather than
 * handed over as bytes.
 */
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
/** Prefer a revocable API key for sends; fall back to the account credentials. */
const API_KEY_SID = process.env.TWILIO_API_KEY_SID;
const API_KEY_SECRET = process.env.TWILIO_API_KEY_SECRET;
const FROM = process.env.TWILIO_WHATSAPP_FROM;
const STATUS_CALLBACK = process.env.TWILIO_STATUS_CALLBACK_URL;

const API_ROOT = "https://api.twilio.com/2010-04-01";

/**
 * Twilio's own timeout is generous; ours is not. A send sits on the order
 * screen's critical path exactly as the OpenWA one did, so it gets the same
 * bounded treatment rather than being allowed to burn the function budget.
 */
const SEND_TIMEOUT_MS = 15_000;

/** How long a signed media URL stays fetchable. Twilio pulls it immediately. */
const MEDIA_URL_TTL_SECONDS = 3600;

export function isTwilioConfigured(): boolean {
  return Boolean(ACCOUNT_SID && AUTH_TOKEN && FROM);
}

/** `whatsapp:+9665…` — Twilio addresses every WhatsApp endpoint this way. */
function waAddress(e164: string): string {
  const trimmed = e164.trim();
  return trimmed.startsWith("whatsapp:") ? trimmed : `whatsapp:${trimmed}`;
}

function authHeader(): string {
  const user = API_KEY_SID || ACCOUNT_SID!;
  const pass = API_KEY_SID ? API_KEY_SECRET! : AUTH_TOKEN!;
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

async function createMessage(fields: Record<string, string>): Promise<SendResult> {
  if (!isTwilioConfigured()) {
    throw new Error(
      "Twilio not configured: set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_WHATSAPP_FROM",
    );
  }

  const body = new URLSearchParams({
    From: waAddress(FROM!),
    ...(STATUS_CALLBACK ? { StatusCallback: STATUS_CALLBACK } : {}),
    ...fields,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_ROOT}/Accounts/${ACCOUNT_SID}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (cause) {
    throw new Error(
      controller.signal.aborted
        ? `Twilio did not respond within ${SEND_TIMEOUT_MS}ms`
        : "Twilio unreachable",
      { cause },
    );
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json().catch(() => ({}) as Record<string, unknown>);
  if (!res.ok) {
    // Twilio's numeric code is the useful half — 63016 in particular means the
    // service window has closed and the caller should retry with a template.
    const code = data?.code ? `${data.code}` : `${res.status}`;
    const detail = typeof data?.message === "string" ? data.message : "";
    throw new Error(`TWILIO_${code}: ${detail}`.trim());
  }
  return { providerMessageId: (data?.sid as string) ?? "" };
}

export const twilioTransport: MessageTransport = {
  provider: "twilio",

  async sendText(toE164, body) {
    return createMessage({ To: waAddress(toE164), Body: body });
  },

  async sendMedia(toE164, media: OutboundMedia) {
    // Twilio fetches media itself, so bytes are useless here — the caller has
    // already put the file in the bucket (every send path stores its own copy
    // before reaching a transport) and we hand Twilio a signed URL to that.
    if (!media.storagePath) {
      throw new Error(
        "TWILIO_MEDIA_NEEDS_STORAGE_PATH: upload to whatsapp-media before sending",
      );
    }
    const url = await signMediaUrl(media.storagePath, MEDIA_URL_TTL_SECONDS);
    if (!url) throw new Error("TWILIO_MEDIA_URL_FAILED: could not sign media URL");

    return createMessage({
      To: waAddress(toE164),
      MediaUrl: url,
      // A caption rides as the message body alongside the attachment. `ptt` is
      // dropped deliberately: the Business Platform has no voice-note flag, so
      // audio arrives as a player rather than a waveform bubble.
      ...(media.caption ? { Body: media.caption } : {}),
    });
  },

  async sendTemplate(toE164, contentSid, variables: TemplateVariables) {
    return createMessage({
      To: waAddress(toE164),
      ContentSid: contentSid,
      ...(Object.keys(variables).length
        ? { ContentVariables: JSON.stringify(variables) }
        : {}),
    });
  },
};

export interface TwilioSenderStatus {
  configured: boolean;
  provider: "twilio";
  number: string | null;
  /** not_configured | online | error */
  state: string;
  error: string | null;
}

/**
 * What the Connect page shows in place of a QR code. Registration happens once,
 * in Twilio's console, so there is nothing here to scan, refresh or re-pair —
 * only whether the sender we are configured for is usable.
 */
export function getTwilioSenderStatus(): TwilioSenderStatus {
  if (!isTwilioConfigured()) {
    return {
      configured: false,
      provider: "twilio",
      number: FROM ?? null,
      state: "not_configured",
      error: null,
    };
  }
  return {
    configured: true,
    provider: "twilio",
    number: FROM!.replace(/^whatsapp:/, ""),
    state: "online",
    error: null,
  };
}
