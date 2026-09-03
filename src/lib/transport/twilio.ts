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
/*
 * Every value is trimmed. These are pasted into a deployment dashboard by hand,
 * and a trailing space or newline rides along more often than not — an untrimmed
 * `From` is not a valid WhatsApp address and an untrimmed account sid produces a
 * 404 against an API path that looks correct in the logs.
 */
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID?.trim();
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN?.trim();
/** Prefer a revocable API key for sends; fall back to the account credentials. */
const API_KEY_SID = process.env.TWILIO_API_KEY_SID?.trim();
const API_KEY_SECRET = process.env.TWILIO_API_KEY_SECRET?.trim();
const FROM = process.env.TWILIO_WHATSAPP_FROM?.trim();
const STATUS_CALLBACK = process.env.TWILIO_STATUS_CALLBACK_URL?.trim();

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
  return Boolean(ACCOUNT_SID && AUTH_TOKEN);
}

/** `whatsapp:+9665…` — Twilio addresses every WhatsApp endpoint this way. */
function waAddress(e164: string): string {
  const trimmed = e164.trim();
  return trimmed.startsWith("whatsapp:") ? trimmed : `whatsapp:${trimmed}`;
}

function authHeader(): string {
  // An API key is only usable as a pair. Keying off the sid alone meant a
  // half-configured key sent "SK…:undefined" and came back as a bare 401 with
  // nothing in it to say which credential was at fault.
  const useApiKey = Boolean(API_KEY_SID && API_KEY_SECRET);
  const user = useApiKey ? API_KEY_SID! : ACCOUNT_SID!;
  const pass = useApiKey ? API_KEY_SECRET! : AUTH_TOKEN!;
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

/**
 * Twilio's numeric code out of an error this module threw.
 *
 * Stored beside the failed message so a send that did not happen can be
 * explained from the inbox rather than from a console someone has to go and
 * find. 63016 in particular means the service window had closed.
 */
export function twilioErrorCode(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const match = /^TWILIO_([A-Za-z0-9]+):/.exec(error.message);
  return match ? match[1] : null;
}

async function createMessage(
  fields: Record<string, string>,
  from?: string | null,
): Promise<SendResult> {
  if (!isTwilioConfigured()) {
    throw new Error(
      "Twilio not configured: set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_WHATSAPP_FROM",
    );
  }

  const body = new URLSearchParams({
    // The conversation's own number wins over configuration: it came from the
    // provider on the inbound message, so it cannot be stale or mistyped.
    From: waAddress((from || FROM)!),
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
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `TWILIO_${res.status}: authentication rejected using ` +
          `${API_KEY_SID && API_KEY_SECRET ? "API key" : "account sid + auth token"}` +
          ` for account ${ACCOUNT_SID?.slice(0, 6)}…`,
      );
    }
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

  async sendText(toE164, body, options) {
    return createMessage({ To: waAddress(toE164), Body: body }, options?.from);
  },

  async sendMedia(toE164, media: OutboundMedia, options) {
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
    }, options?.from);
  },

  async sendTemplate(toE164, contentSid, variables: TemplateVariables, options) {
    return createMessage({
      To: waAddress(toE164),
      ContentSid: contentSid,
      ...(Object.keys(variables).length
        ? { ContentVariables: JSON.stringify(variables) }
        : {}),
    }, options?.from);
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
