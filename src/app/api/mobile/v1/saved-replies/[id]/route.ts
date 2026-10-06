import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";
import { deleteSavedReply, updateSavedReply } from "@/lib/saved-replies";

const MAX_TITLE = 120;
const MAX_BODY = 2000;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;
  const payload: unknown = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return mobileError(400, "INVALID_JSON", "A JSON object is required");
  }
  const input = payload as { title?: unknown; body?: unknown };
  const title = typeof input.title === "string" ? input.title.trim().slice(0, MAX_TITLE) : "";
  const body = typeof input.body === "string" ? input.body.trim().slice(0, MAX_BODY) : "";
  if (!title) return mobileError(400, "TITLE_REQUIRED", "عنوان الرسالة مطلوب");
  if (!body) return mobileError(400, "BODY_REQUIRED", "نص الرسالة مطلوب");

  try {
    const { id } = await params;
    const savedReply = await updateSavedReply(id, { title, body });
    return mobileData({ ok: true, savedReply });
  } catch (error) {
    return mobileServerError(error, "SAVED_REPLY_UPDATE_FAILED", "تعذّر تحديث الرسالة الجاهزة");
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;
  try {
    const { id } = await params;
    await deleteSavedReply(id);
    return mobileData({ ok: true });
  } catch (error) {
    return mobileServerError(error, "SAVED_REPLY_DELETE_FAILED", "تعذّر حذف الرسالة الجاهزة");
  }
}
