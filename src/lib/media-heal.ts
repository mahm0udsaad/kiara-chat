import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import { downloadMetaMedia } from "@/lib/transport/meta";
import { uploadBase64Media, type StoredMediaSlot } from "@/lib/storage-media";

/** Meta keeps inbound media for about 30 days; stop a little before that. */
const HEAL_WINDOW_MS = 29 * 24 * 60 * 60 * 1000;
const MAX_HEAL_ATTEMPTS = 3;
/** Bounds the work one page load can kick off. */
const MAX_HEALS_PER_PAGE = 5;

interface HealCandidate {
  id: string;
  created_at: string;
  metadata?: unknown;
}

function healableSlot(slot: StoredMediaSlot | undefined): boolean {
  return Boolean(
    slot &&
      !slot.storage_path &&
      slot.delivery_status === "failed" &&
      slot.provider_media_id &&
      (slot.heal_attempts ?? 0) < MAX_HEAL_ATTEMPTS,
  );
}

/** Messages on this page whose Meta media failed to store but can be retried. */
export function messagesNeedingHeal(rows: HealCandidate[]): string[] {
  const cutoff = Date.now() - HEAL_WINDOW_MS;
  return rows
    .filter((row) => {
      if (new Date(row.created_at).getTime() < cutoff) return false;
      const media = (row.metadata as { media?: StoredMediaSlot[] } | null)?.media;
      return Array.isArray(media) && media.some(healableSlot);
    })
    .slice(0, MAX_HEALS_PER_PAGE)
    .map((row) => row.id);
}

/**
 * Re-fetch failed inbound files from Meta and store them. Runs after the
 * thread has been sent, so it never slows opening a chat; the file shows on
 * the next load. Each slot gets a few tries, then stays as "couldn't store".
 */
export async function healFailedMetaMedia(
  conversationId: string,
  messageIds: string[],
): Promise<void> {
  const admin = getAdminSupabaseClient();
  for (const messageId of messageIds) {
    try {
      // Re-read so a concurrent metadata change (e.g. hiding the message)
      // isn't overwritten with the stale copy from the page.
      const { data: row } = await admin
        .from("messages")
        .select("id, metadata")
        .eq("id", messageId)
        .eq("conversation_id", conversationId)
        .maybeSingle();
      const metadata = (row?.metadata as Record<string, unknown> | null) ?? null;
      const media = metadata?.media as StoredMediaSlot[] | undefined;
      if (!metadata || !Array.isArray(media) || !media.some(healableSlot)) continue;

      const healed: StoredMediaSlot[] = [];
      for (const slot of media) {
        if (!healableSlot(slot)) {
          healed.push(slot);
          continue;
        }
        const attempts = (slot.heal_attempts ?? 0) + 1;
        try {
          const downloaded = await downloadMetaMedia(slot.provider_media_id!);
          const stored = await uploadBase64Media({
            restaurantId: KIARA_RESTAURANT_ID,
            conversationId,
            contentType: slot.content_type || downloaded.contentType,
            base64: downloaded.buffer.toString("base64"),
            originalFilename: slot.original_filename ?? null,
          });
          healed.push(
            stored.delivery_status === "failed"
              ? { ...slot, heal_attempts: attempts, fetch_error: stored.fetch_error ?? null }
              : stored,
          );
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          healed.push({ ...slot, heal_attempts: attempts, fetch_error: detail.slice(0, 300) });
        }
      }

      await admin
        .from("messages")
        .update({ metadata: { ...metadata, media: healed } })
        .eq("id", messageId);
    } catch (error) {
      console.error(`[media/heal] message ${messageId}`, error);
    }
  }
}
