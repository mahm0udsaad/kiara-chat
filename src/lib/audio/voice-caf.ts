/**
 * The iOS-playable companion for a stored voice note.
 *
 * Conversion is lazy and cached: the first listener on an Apple device pays
 * for the remux, everyone after that gets the stored `.caf`. Doing it here
 * rather than in the ingest webhook keeps Meta's webhook timeout out of the
 * picture and — the reason that actually matters — covers the voice notes
 * already sitting in the bucket, which have never been playable on an iPhone.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { WHATSAPP_MEDIA_BUCKET } from "@/lib/storage-media";
import { oggOpusToCaf } from "@/lib/audio/opus-caf";

const CAF_CONTENT_TYPE = "audio/x-caf";

/** Same folder, same name, different container — so the tenant and
 *  conversation segments the media routes authorize against are unchanged. */
export function cafPathFor(oggPath: string): string | null {
  const match = /^(.*)\.(ogg|opus)$/i.exec(oggPath);
  return match ? `${match[1]}.caf` : null;
}

/**
 * Returns the storage path of the CAF companion, creating it if this is the
 * first request for it. Returns null when the source is not a remuxable
 * Ogg/Opus file or the conversion fails — the caller then serves the
 * original, which is still correct for Android and Chrome.
 */
export async function ensureCafCompanion(oggPath: string): Promise<string | null> {
  const cafPath = cafPathFor(oggPath);
  if (!cafPath) return null;

  const supabase = getAdminSupabaseClient();
  const bucket = supabase.storage.from(WHATSAPP_MEDIA_BUCKET);

  const folder = cafPath.slice(0, cafPath.lastIndexOf("/"));
  const name = cafPath.slice(cafPath.lastIndexOf("/") + 1);
  const { data: existing } = await bucket.list(folder, { search: name, limit: 1 });
  if (existing?.some((entry) => entry.name === name)) return cafPath;

  const { data: source, error: downloadError } = await bucket.download(oggPath);
  if (downloadError || !source) {
    console.error("[voice-caf] source download failed", oggPath, downloadError?.message);
    return null;
  }

  let caf: Buffer;
  try {
    caf = oggOpusToCaf(Buffer.from(await source.arrayBuffer())).buffer;
  } catch (error) {
    // A file that is not Ogg/Opus after all, or a truncated one. Not worth an
    // error: the original still plays everywhere except Apple.
    console.warn(
      "[voice-caf] remux skipped",
      oggPath,
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }

  // `upsert` so two listeners opening the same note at once cannot race each
  // other into a 409 — the bytes are deterministic, so a double write is
  // harmless.
  const { error: uploadError } = await bucket.upload(cafPath, caf, {
    contentType: CAF_CONTENT_TYPE,
    upsert: true,
    cacheControl: "3600",
  });
  if (uploadError) {
    console.error("[voice-caf] upload failed", cafPath, uploadError.message);
    return null;
  }
  return cafPath;
}
