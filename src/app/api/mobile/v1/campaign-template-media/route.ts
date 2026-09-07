/**
 * Upload the sample image used while a WhatsApp media template is submitted.
 *
 * The Content API needs a URL it can fetch, while the employee should never
 * have to find or paste one.  The image stays in our private media bucket and
 * this route returns a time-limited URL just for Twilio/Meta's review.
 */
import { randomUUID } from "crypto";

import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import { extFromContentType, WHATSAPP_MEDIA_BUCKET } from "@/lib/storage-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Matches the mobile client's transport-safe limit, including multipart data. */
const MAX_TEMPLATE_IMAGE_BYTES = 4 * 1024 * 1024;
/** Meta can fetch the sample during its review without making the bucket public. */
const SAMPLE_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

export async function POST(request: Request) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return mobileError(400, "INVALID_FORM_DATA", "الطلب يجب أن يكون multipart/form-data");
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return mobileError(400, "EMPTY_IMAGE", "اختاري صورة للقالب");
  }
  if (file.size > MAX_TEMPLATE_IMAGE_BYTES) {
    return mobileError(413, "IMAGE_TOO_LARGE", "الصورة أكبر من الحد المسموح (4 ميجابايت)");
  }

  const contentType = (file.type || "").toLowerCase().split(";")[0].trim();
  if (!contentType.startsWith("image/")) {
    return mobileError(415, "NOT_AN_IMAGE", "اختاري صورة بصيغة مدعومة");
  }

  const path = `${KIARA_RESTAURANT_ID}/template-samples/${randomUUID()}.${extFromContentType(contentType)}`;
  try {
    const storage = getAdminSupabaseClient().storage.from(WHATSAPP_MEDIA_BUCKET);
    const { error: uploadError } = await storage.upload(path, Buffer.from(await file.arrayBuffer()), {
      contentType,
      cacheControl: "31536000",
      upsert: false,
    });
    if (uploadError) throw uploadError;

    const { data, error: signError } = await storage.createSignedUrl(path, SAMPLE_URL_TTL_SECONDS);
    if (signError || !data?.signedUrl) throw signError ?? new Error("Could not sign template image");
    return mobileData({ url: data.signedUrl, path }, 201);
  } catch (error) {
    return mobileServerError(error, "TEMPLATE_IMAGE_UPLOAD_FAILED", "تعذّر رفع الصورة");
  }
}
