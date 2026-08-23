import { randomUUID } from "crypto";

import { extFromContentType, WHATSAPP_MEDIA_BUCKET } from "@/lib/storage-media";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import type { Conversation } from "@/lib/types";

export interface BookingReceipt {
  storagePath: string;
  contentType: string;
  sizeBytes: number | null;
  originalFilename: string | null;
  uploadedAt: string;
}

type StoredBookingReceipt = {
  storage_path: string;
  content_type: string;
  size_bytes: number | null;
  original_filename: string | null;
  uploaded_at: string;
  uploaded_by: string;
};

/** Read the current invoice/receipt attachment from conversation metadata. */
export function bookingReceiptOf(
  conversation: Pick<Conversation, "metadata">
): BookingReceipt | null {
  const value = (
    conversation.metadata as { booking_receipt?: unknown } | null
  )?.booking_receipt;
  if (!value || typeof value !== "object") return null;

  const receipt = value as Partial<StoredBookingReceipt>;
  if (
    typeof receipt.storage_path !== "string" ||
    !receipt.storage_path ||
    typeof receipt.content_type !== "string" ||
    !receipt.content_type ||
    typeof receipt.uploaded_at !== "string" ||
    !receipt.uploaded_at
  ) {
    return null;
  }

  return {
    storagePath: receipt.storage_path,
    contentType: receipt.content_type,
    sizeBytes:
      typeof receipt.size_bytes === "number" ? receipt.size_bytes : null,
    originalFilename:
      typeof receipt.original_filename === "string"
        ? receipt.original_filename
        : null,
    uploadedAt: receipt.uploaded_at,
  };
}

function buildBookingReceiptPath(params: {
  restaurantId: string;
  conversationId: string;
  contentType: string;
}) {
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const id = `${Date.now().toString(36)}${randomUUID().replace(/-/g, "").slice(0, 18)}`;
  const extension = extFromContentType(params.contentType);
  return `${params.restaurantId}/${params.conversationId}/receipts/${year}/${month}/${id}.${extension}`;
}

/**
 * Persist one private receipt and its database record.
 *
 * Every replacement receives a new path to avoid stale CDN content. If the
 * metadata write fails, only the just-created, unreachable object is removed.
 */
export async function saveBookingReceipt(params: {
  conversation: Pick<Conversation, "id" | "restaurant_id">;
  buffer: Buffer;
  contentType: string;
  originalFilename: string | null;
  uploadedBy: string;
}): Promise<BookingReceipt> {
  const admin = getAdminSupabaseClient();
  const path = buildBookingReceiptPath({
    restaurantId: params.conversation.restaurant_id,
    conversationId: params.conversation.id,
    contentType: params.contentType,
  });
  const uploadedAt = new Date().toISOString();
  const stored: StoredBookingReceipt = {
    storage_path: path,
    content_type: params.contentType,
    size_bytes: params.buffer.byteLength,
    original_filename: params.originalFilename,
    uploaded_at: uploadedAt,
    uploaded_by: params.uploadedBy,
  };

  const { error: uploadError } = await admin.storage
    .from(WHATSAPP_MEDIA_BUCKET)
    .upload(path, params.buffer, {
      contentType: params.contentType,
      upsert: false,
      cacheControl: "3600",
    });
  if (uploadError) throw new Error(uploadError.message);

  // Re-read just before the patch so a label/status write made while the file
  // was uploading is not replaced by the older conversation snapshot.
  const { data: latest, error: readError } = await admin
    .from("conversations")
    .select("metadata")
    .eq("id", params.conversation.id)
    .eq("restaurant_id", params.conversation.restaurant_id)
    .maybeSingle();
  if (readError || !latest) {
    await admin.storage.from(WHATSAPP_MEDIA_BUCKET).remove([path]);
    throw new Error(readError?.message || "Conversation no longer exists");
  }

  const metadata = {
    ...((latest.metadata as Record<string, unknown> | null) ?? {}),
    booking_receipt: stored,
  };
  const { data: updated, error: updateError } = await admin
    .from("conversations")
    .update({ metadata })
    .eq("id", params.conversation.id)
    .eq("restaurant_id", params.conversation.restaurant_id)
    .select("id")
    .maybeSingle();

  if (updateError || !updated) {
    await admin.storage.from(WHATSAPP_MEDIA_BUCKET).remove([path]);
    throw new Error(updateError?.message || "Conversation no longer exists");
  }

  return {
    storagePath: path,
    contentType: params.contentType,
    sizeBytes: params.buffer.byteLength,
    originalFilename: params.originalFilename,
    uploadedAt,
  };
}
