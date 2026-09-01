/**
 * GET /api/mobile/v1/media?path=<storagePath> — a short-lived signed URL for a
 * whatsapp-media object, so the phone can show the photo or play the voice
 * note attached to a message.
 *
 * Mirrors the web `/api/media` route, including the tenant-prefix check that
 * stops a caller guessing at another restaurant's objects.
 *
 * Authorization happens here, in full, before anything is signed: the path must
 * sit under Kiara's tenant folder, and the conversation in its second segment
 * must be one this viewer can actually open. Only then is the URL signed with
 * the admin client.
 *
 * It used to sign with the caller's own RLS client as a "second line of
 * defence". There is no storage policy granting an employee read on the
 * private bucket, so that line was not second — it was the only one, and it
 * failed closed on every attachment. Storage answers an RLS denial with
 * `Object not found`, which the app then printed into the chat bubble, so a
 * perfectly intact voice note read to staff as a missing file.
 */
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import { getConversationById } from "@/lib/inbox";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
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
  const conversationId = path.split("/")[1] ?? "";
  if (!conversationId) {
    return mobileError(400, "INVALID_MEDIA_PATH", "مسار الملف غير صحيح");
  }

  try {
    const conversation = await getConversationById(conversationId, {
      isAdmin: auth.session.role === "admin",
      teamMemberId: auth.session.teamMemberId,
    });
    if (!conversation) {
      return mobileError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");
    }
    const supabase = getAdminSupabaseClient();
    const { data, error } = await supabase.storage
      .from(WHATSAPP_MEDIA_BUCKET)
      .createSignedUrl(path, TTL_SECONDS);
    if (error || !data?.signedUrl) {
      // Deliberately not `error.message`: that is where "Object not found"
      // came from, in English, inside an Arabic conversation.
      console.error("[media] sign failed", { path, error });
      return mobileError(502, "SIGN_FAILED", "تعذّر تحميل الملف");
    }
    return mobileData({ url: data.signedUrl, expiresIn: TTL_SECONDS });
  } catch (error) {
    return mobileServerError(error, "MEDIA_URL_FAILED", "تعذّر تحميل الملف");
  }
}
