/**
 * GET /api/mobile/v1/media?path=<storagePath> — a short-lived signed URL for a
 * whatsapp-media object, so the phone can show the photo or play the voice
 * note attached to a message.
 *
 * Mirrors the web `/api/media` route, including the tenant-prefix check that
 * stops a caller guessing at another restaurant's objects. The client here is
 * the RLS-respecting one built from the bearer token, so storage policies are
 * still the second line of defence.
 */
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";
import { WHATSAPP_MEDIA_BUCKET } from "@/lib/storage-media";

export const dynamic = "force-dynamic";

/** Long enough to open a thread and scroll it, short enough not to leak. */
const TTL_SECONDS = 3600;

export async function GET(request: Request) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  const path = new URL(request.url).searchParams.get("path") ?? "";
  if (!path) {
    return mobileError(400, "MISSING_PATH", "path is required");
  }
  if (path.split("/")[0] !== KIARA_RESTAURANT_ID) {
    return mobileError(403, "TENANT_MISMATCH", "هذا الملف ليس ضمن الحساب");
  }

  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.storage
      .from(WHATSAPP_MEDIA_BUCKET)
      .createSignedUrl(path, TTL_SECONDS);
    if (error || !data?.signedUrl) {
      return mobileError(
        502,
        "SIGN_FAILED",
        error?.message || "تعذّر تحميل الملف"
      );
    }
    return mobileData({ url: data.signedUrl, expiresIn: TTL_SECONDS });
  } catch (error) {
    return mobileServerError(error, "MEDIA_URL_FAILED", "تعذّر تحميل الملف");
  }
}
