import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";
import { createSavedReply, listSavedReplies } from "@/lib/saved-replies";

export const dynamic = "force-dynamic";

const MAX_TITLE = 120;
const MAX_BODY = 2000;

/** The team's canned replies. Bootstrap ships them too; this is the refresh. */
export async function GET(request: Request) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  try {
    return mobileData({ savedReplies: await listSavedReplies() });
  } catch (error) {
    return mobileServerError(
      error,
      "SAVED_REPLIES_FAILED",
      "تعذّر تحميل الرسائل الجاهزة"
    );
  }
}

/**
 * Write a canned reply from the phone.
 *
 * Welcome lines (ترحيب) get rewritten on the floor, not at a desk, so the
 * employee who just typed a better one saves it where she is instead of
 * waiting to reach the dashboard.
 */
export async function POST(request: Request) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return mobileError(400, "INVALID_JSON", "A JSON object is required");
  }

  const title =
    typeof payload.title === "string" ? payload.title.trim().slice(0, MAX_TITLE) : "";
  const body =
    typeof payload.body === "string" ? payload.body.trim().slice(0, MAX_BODY) : "";
  if (!title) {
    return mobileError(400, "TITLE_REQUIRED", "عنوان الرسالة مطلوب");
  }
  if (!body) {
    return mobileError(400, "BODY_REQUIRED", "نص الرسالة مطلوب");
  }

  try {
    const savedReply = await createSavedReply(auth.session.userId, title, body);
    return mobileData({ savedReply }, 201);
  } catch (error) {
    return mobileServerError(
      error,
      "SAVED_REPLY_CREATE_FAILED",
      "تعذّر حفظ الرسالة الجاهزة"
    );
  }
}
