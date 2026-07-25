/**
 * whatsapp-media storage helpers (Kiara side). The persistent OpenWA service
 * POSTs media as base64 to the ingest endpoint; we upload it into the shared
 * `whatsapp-media` bucket using the same tenant/conversation path convention
 * the parent app uses, so historical + live media live together.
 */
import { randomUUID } from "crypto";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";

export const WHATSAPP_MEDIA_BUCKET = "whatsapp-media";
export const MAX_MEDIA_BYTES = 20 * 1024 * 1024;

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
}): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear().toString();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const ext = extFromContentType(params.contentType);
  const id = `${Date.now().toString(36)}${randomUUID().replace(/-/g, "").slice(0, 18)}`;
  return `${params.restaurantId}/${params.conversationId}/${yyyy}/${mm}/${id}.${ext}`;
}

export interface StoredMediaSlot {
  storage_path: string | null;
  content_type: string;
  size_bytes: number | null;
  original_filename?: string | null;
  delivery_status: "stored" | "too_large" | "failed";
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
    if (error) return base;
    return { ...base, storage_path: path, delivery_status: "stored" };
  } catch {
    return base;
  }
}
