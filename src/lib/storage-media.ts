/**
 * whatsapp-media storage helpers (Kiara side). The persistent OpenWA service
 * POSTs media as base64 to the ingest endpoint; we upload it into the shared
 * `whatsapp-media` bucket using the same tenant/conversation path convention
 * the parent app uses, so historical + live media live together.
 */
import { randomUUID } from "crypto";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";

export const WHATSAPP_MEDIA_BUCKET = "whatsapp-media";
/**
 * 16 MB is the Business Platform's ceiling for the largest media type, and it
 * is lower than the 20 MB a linked device would accept — so the tighter limit
 * applies to both transports rather than letting a send fail after the message
 * row has already been written.
 */
export const MAX_MEDIA_BYTES = 16 * 1024 * 1024;
/** WhatsApp's tighter per-image ceiling; other media can use the full cap. */
export const MAX_IMAGE_MEDIA_BYTES = 5 * 1024 * 1024;

export function maxMediaBytesForContentType(contentType: string): number {
  const normalized = contentType.toLowerCase().split(";")[0].trim();
  return normalized.startsWith("image/")
    ? MAX_IMAGE_MEDIA_BYTES
    : MAX_MEDIA_BYTES;
}

const CONTENT_TYPE_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/heic": "heic",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "audio/wav": "wav",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/csv": "csv",
};

export function extFromContentType(contentType: string): string {
  const ct = (contentType || "").toLowerCase().split(";")[0].trim();
  return CONTENT_TYPE_TO_EXT[ct] || "bin";
}

/** MIME → messages.message_type. audio/ogg = WhatsApp voice note. */
export function messageTypeFromContentType(contentType: string): string {
  const ct = (contentType || "").toLowerCase().split(";")[0].trim();
  if (ct.startsWith("image/")) return "image";
  if (ct === "audio/ogg" || ct === "audio/opus") return "voice";
  if (ct.startsWith("audio/")) return "audio";
  if (ct.startsWith("video/")) return "video";
  if (ct.startsWith("application/") || ct.startsWith("text/")) return "document";
  return "file";
}

export function buildMediaStoragePath(params: {
  restaurantId: string;
  conversationId: string;
  contentType: string;
  /** Stable for direct-upload retries; random for ordinary server uploads. */
  objectId?: string;
}): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear().toString();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const ext = extFromContentType(params.contentType);
  const id = params.objectId
    ? params.objectId.replace(/-/g, "")
    : `${Date.now().toString(36)}${randomUUID().replace(/-/g, "").slice(0, 18)}`;
  return `${params.restaurantId}/${params.conversationId}/${yyyy}/${mm}/${id}.${ext}`;
}

export interface StoredMediaSlot {
  storage_path: string | null;
  content_type: string;
  size_bytes: number | null;
  original_filename?: string | null;
  delivery_status: "stored" | "too_large" | "failed";
  /**
   * The provider URL the bytes were meant to come from, kept only when the
   * fetch failed. Twilio holds inbound media until the account deletes it, so
   * a failure here is recoverable — but only if the address survives the
   * failure. Without it a lost receipt can never be fetched again.
   */
  source_url?: string | null;
  /** Why the fetch failed, for the backfill and for the logs. */
  fetch_error?: string | null;
}

/** Upload one base64 media blob into the bucket. Never throws — returns a slot. */
export async function uploadBase64Media(params: {
  restaurantId: string;
  conversationId: string;
  contentType: string;
  base64: string;
  originalFilename?: string | null;
}): Promise<StoredMediaSlot> {
  const buffer = Buffer.from(params.base64, "base64");
  const base: StoredMediaSlot = {
    storage_path: null,
    content_type: params.contentType,
    size_bytes: buffer.byteLength,
    original_filename: params.originalFilename ?? null,
    delivery_status: "failed",
  };
  // Inbound provider media keeps the existing 16 MB archival ceiling. The
  // stricter 5 MB image limit applies only to outbound WhatsApp sends.
  if (buffer.byteLength > MAX_MEDIA_BYTES) {
    return { ...base, delivery_status: "too_large" };
  }
  try {
    const path = buildMediaStoragePath({
      restaurantId: params.restaurantId,
      conversationId: params.conversationId,
      contentType: params.contentType,
    });
    const { error } = await getAdminSupabaseClient()
      .storage.from(WHATSAPP_MEDIA_BUCKET)
      .upload(path, buffer, {
        contentType: params.contentType,
        upsert: false,
        cacheControl: "3600",
      });
    if (error) {
      console.error("[media] upload failed", params.contentType, error.message);
      return { ...base, fetch_error: `upload: ${error.message}` };
    }
    return { ...base, storage_path: path, delivery_status: "stored" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[media] upload threw", params.contentType, message);
    return { ...base, fetch_error: `upload: ${message}` };
  }
}

/**
 * A time-limited public URL for a stored object.
 *
 * The bucket is private, and Twilio fetches outbound media from a URL of its
 * own accord rather than accepting bytes — so a send needs a link that is
 * reachable without our credentials but stops working shortly afterwards.
 * Returns null rather than throwing: a caller that cannot get a URL has a
 * send to fail, not an exception to propagate.
 */
export async function signMediaUrl(
  storagePath: string,
  ttlSeconds = 3600,
): Promise<string | null> {
  try {
    const { data, error } = await getAdminSupabaseClient()
      .storage.from(WHATSAPP_MEDIA_BUCKET)
      .createSignedUrl(storagePath, ttlSeconds);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

/**
 * Twilio answers a media URL with 404 or 5xx for a moment after the webhook
 * fires — the message is delivered before the media finishes landing in its
 * own store — so roughly one inbound file in twenty was being dropped by a
 * single-shot fetch. Three attempts spread over ~1.6s cover that window while
 * staying well inside Twilio's own webhook timeout.
 */
const MEDIA_FETCH_ATTEMPTS = 3;
const MEDIA_FETCH_BACKOFF_MS = [400, 1200];

/** 404 included: the object exists, it is just not readable yet. */
function isRetryableStatus(status: number): boolean {
  return status === 404 || status === 408 || status === 429 || status >= 500;
}

/**
 * Pull one inbound media file from a provider URL into our own bucket.
 *
 * Twilio hosts inbound media behind the account credentials, so the webhook
 * fetches and persists it now — the thread must still render the receipt next
 * week. A failure keeps the URL on the slot so the backfill can retry it.
 */
export async function storeMediaFromUrl(params: {
  restaurantId: string;
  conversationId: string;
  url: string;
  contentType: string;
  /** Basic-auth credentials, when the provider's media URL requires them. */
  auth?: { username: string; password: string } | null;
  originalFilename?: string | null;
}): Promise<StoredMediaSlot> {
  const base: StoredMediaSlot = {
    storage_path: null,
    content_type: params.contentType,
    size_bytes: null,
    original_filename: params.originalFilename ?? null,
    delivery_status: "failed",
  };
  const headers: Record<string, string> = {};
  if (params.auth) {
    const token = Buffer.from(
      `${params.auth.username}:${params.auth.password}`,
    ).toString("base64");
    headers.Authorization = `Basic ${token}`;
  }

  let lastError = "unknown";
  for (let attempt = 0; attempt < MEDIA_FETCH_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, MEDIA_FETCH_BACKOFF_MS[attempt - 1] ?? 1200),
      );
    }
    try {
      const res = await fetch(params.url, { headers, cache: "no-store" });
      if (res.ok) {
        const buffer = Buffer.from(await res.arrayBuffer());
        return await uploadBase64Media({
          restaurantId: params.restaurantId,
          conversationId: params.conversationId,
          contentType: params.contentType,
          base64: buffer.toString("base64"),
          originalFilename: params.originalFilename ?? null,
        });
      }
      lastError = `HTTP ${res.status}`;
      console.warn(
        `[media] fetch ${lastError} (attempt ${attempt + 1}/${MEDIA_FETCH_ATTEMPTS})`,
        params.contentType,
      );
      if (!isRetryableStatus(res.status)) break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.warn(
        `[media] fetch threw (attempt ${attempt + 1}/${MEDIA_FETCH_ATTEMPTS})`,
        params.contentType,
        lastError,
      );
    }
  }

  console.error("[media] fetch gave up", params.contentType, lastError);
  return { ...base, source_url: params.url, fetch_error: lastError };
}
