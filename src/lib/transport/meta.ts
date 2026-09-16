import { signMediaUrl } from "@/lib/storage-media";
import { metaCloudConfig, metaErrorCode, metaGraphCall, isMetaCloudConfigured } from "./meta-api";
import { resolveMetaTemplateIdentifier } from "./meta-content";
import type {
  MessageTransport,
  OutboundMedia,
  SendResult,
  TemplateVariables,
} from "./types";

const MEDIA_URL_TTL_SECONDS = 3600;

function recipient(e164: string): string {
  return e164.trim().replace(/\D/g, "");
}

async function sendMessage(payload: Record<string, unknown>): Promise<SendResult> {
  const { phoneNumberId } = metaCloudConfig();
  if (!phoneNumberId) {
    throw new Error("Meta Cloud API is not configured: missing phone number ID");
  }
  const result = await metaGraphCall<{ messages?: Array<{ id?: string }> }>(
    `/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
    },
  );
  const id = result.messages?.[0]?.id;
  if (!id) throw new Error("META_EMPTY_RESPONSE: no message id returned");
  return { providerMessageId: id };
}

function mediaType(contentType: string): "image" | "video" | "audio" | "document" {
  const normalized = contentType.toLowerCase().split(";")[0].trim();
  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("video/")) return "video";
  if (normalized.startsWith("audio/")) return "audio";
  return "document";
}

export const metaTransport: MessageTransport = {
  provider: "meta",

  async sendText(toE164, body) {
    return sendMessage({
      recipient_type: "individual",
      to: recipient(toE164),
      type: "text",
      text: { preview_url: false, body },
    });
  },

  async sendMedia(toE164, media: OutboundMedia) {
    if (!media.storagePath) {
      throw new Error(
        "META_MEDIA_NEEDS_STORAGE_PATH: upload to whatsapp-media before sending",
      );
    }
    const link = await signMediaUrl(media.storagePath, MEDIA_URL_TTL_SECONDS);
    if (!link) throw new Error("META_MEDIA_URL_FAILED: could not sign media URL");
    const type = mediaType(media.contentType);
    const value: Record<string, string> = { link };
    if (type === "document" && media.filename) value.filename = media.filename;
    if ((type === "image" || type === "video" || type === "document") && media.caption) {
      value.caption = media.caption;
    }
    return sendMessage({ to: recipient(toE164), type, [type]: value });
  },

  async sendTemplate(toE164, identifier, variables: TemplateVariables) {
    const template = await resolveMetaTemplateIdentifier(identifier);
    const keys = Object.keys(variables).sort((a, b) => Number(a) - Number(b));
    return sendMessage({
      to: recipient(toE164),
      type: "template",
      template: {
        name: template.name,
        language: { policy: "deterministic", code: template.language },
        ...(keys.length
          ? {
              components: [
                {
                  type: "body",
                  parameters: keys.map((key) => ({ type: "text", text: variables[key] })),
                },
              ],
            }
          : {}),
      },
    });
  },
};

export interface MetaSenderStatus {
  configured: boolean;
  provider: "meta";
  number: string | null;
  state: string;
  error: string | null;
}

export function getMetaSenderStatus(): MetaSenderStatus {
  return {
    configured: isMetaCloudConfigured(),
    provider: "meta",
    number: process.env.META_CLOUD_PHONE_NUMBER?.trim() || null,
    state: isMetaCloudConfigured() ? "configured" : "not_configured",
    error: null,
  };
}

export async function downloadMetaMedia(mediaId: string): Promise<{
  buffer: Buffer;
  contentType: string;
  filename: string | null;
}> {
  const metadata = await metaGraphCall<{
    url?: string;
    mime_type?: string;
    file_size?: number;
  }>(`/${encodeURIComponent(mediaId)}`);
  if (!metadata.url) throw new Error("META_MEDIA_METADATA: download URL missing");

  const { accessToken } = metaCloudConfig();
  if (!accessToken) throw new Error("Meta Cloud API is not configured: missing access token");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(metadata.url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`META_MEDIA_DOWNLOAD_${response.status}`);
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      contentType:
        metadata.mime_type ||
        response.headers.get("content-type")?.split(";")[0] ||
        "application/octet-stream",
      filename: null,
    };
  } catch (cause) {
    if (controller.signal.aborted) {
      throw new Error("META_MEDIA_DOWNLOAD_TIMEOUT", { cause });
    }
    throw cause;
  } finally {
    clearTimeout(timer);
  }
}

export { isMetaCloudConfigured, metaErrorCode };
