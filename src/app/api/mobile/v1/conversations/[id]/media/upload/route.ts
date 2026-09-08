/**
 * Mint a short-lived, conversation-scoped Supabase Storage upload URL.
 *
 * The media bytes go phone -> Storage and never cross the Vercel function's
 * 4.5 MB request-body boundary. The caller commits the stored path through the
 * parent media route after the upload succeeds.
 */
import { replyDenialFor } from "@/lib/conversation-reply-access";
import { getConversationById } from "@/lib/inbox";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  buildMediaStoragePath,
  maxMediaBytesForContentType,
  WHATSAPP_MEDIA_BUCKET,
} from "@/lib/storage-media";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => null)) as {
    contentType?: unknown;
    filename?: unknown;
    idempotencyKey?: unknown;
    sizeBytes?: unknown;
  } | null;
  const contentType =
    typeof body?.contentType === "string"
      ? body.contentType.toLowerCase().split(";")[0].trim()
      : "";
  const filename =
    typeof body?.filename === "string"
      ? body.filename.trim().slice(0, 255) || null
      : null;
  const idempotencyKey = String(body?.idempotencyKey ?? "");
  const sizeBytes = Number(body?.sizeBytes);

  if (!contentType || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    return mobileError(400, "INVALID_MEDIA", "بيانات الملف غير مكتملة");
  }
  if (!UUID.test(idempotencyKey)) {
    return mobileError(
      400,
      "INVALID_IDEMPOTENCY_KEY",
      "idempotencyKey must be a UUID",
    );
  }
  if (contentType.startsWith("video/") && contentType !== "video/mp4") {
    return mobileError(
      415,
      "VIDEO_FORMAT_UNSUPPORTED",
      "صيغة الفيديو غير مدعومة. اختاري فيديو MP4.",
    );
  }
  const sizeLimit = maxMediaBytesForContentType(contentType);
  if (sizeBytes > sizeLimit) {
    return mobileError(
      413,
      "FILE_TOO_LARGE",
      `الملف أكبر من الحد المسموح (${sizeLimit / (1024 * 1024)} ميجابايت)`,
    );
  }

  const { id } = await params;
  const viewer = {
    isAdmin: auth.session.role === "admin",
    teamMemberId: auth.session.teamMemberId,
  };

  try {
    const conversation = await getConversationById(id, viewer);
    if (!conversation) {
      return mobileError(
        404,
        "CONVERSATION_NOT_FOUND",
        "Conversation not found",
      );
    }
    const denial = replyDenialFor(conversation, {
      role: auth.session.role,
      teamMemberId: auth.session.teamMemberId,
    });
    if (denial) {
      return mobileError(denial.status, denial.code, denial.message);
    }

    const storagePath = buildMediaStoragePath({
      restaurantId: KIARA_RESTAURANT_ID,
      conversationId: id,
      contentType,
      objectId: idempotencyKey,
    });
    const { data, error } = await getAdminSupabaseClient()
      .storage.from(WHATSAPP_MEDIA_BUCKET)
      .createSignedUploadUrl(storagePath, { upsert: true });
    if (error || !data?.signedUrl) {
      throw new Error(error?.message ?? "Unable to create upload URL");
    }

    return mobileData({
      contentType,
      filename,
      signedUrl: data.signedUrl,
      sizeBytes,
      storagePath,
    });
  } catch (error) {
    return mobileServerError(
      error,
      "MEDIA_UPLOAD_URL_FAILED",
      "تعذّر تجهيز رفع الملف",
    );
  }
}
