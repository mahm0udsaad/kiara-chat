import { deleteLabel, LABEL_COLORS, listLabels, updateLabel } from "@/lib/labels";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";
import type { Label, LabelColor } from "@/lib/types";

type Payload = { name?: unknown; color?: unknown };

function sameLabelName(label: Label, name: string) {
  return label.name.localeCompare(name, "ar", { sensitivity: "base" }) === 0;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;
  const payload = (await request.json().catch(() => null)) as Payload | null;
  const name = typeof payload?.name === "string" ? payload.name.trim() : "";
  const color = payload?.color;
  if (!name || name.length > 40) {
    return mobileError(400, "INVALID_LABEL_NAME", "اكتبي اسمًا للتصنيف لا يزيد عن ٤٠ حرفًا");
  }
  if (typeof color !== "string" || !LABEL_COLORS.includes(color as LabelColor)) {
    return mobileError(400, "INVALID_LABEL_COLOR", "لون التصنيف غير صالح");
  }

  try {
    const { id } = await params;
    const duplicate = (await listLabels()).find(
      (label) => label.id !== id && sameLabelName(label, name),
    );
    if (duplicate) {
      return mobileError(409, "LABEL_NAME_EXISTS", "يوجد تصنيف بهذا الاسم بالفعل");
    }
    return mobileData({ label: await updateLabel(id, name, color as LabelColor) });
  } catch (error) {
    if (error instanceof Error && error.message === "LABEL_NOT_FOUND") {
      return mobileError(404, "LABEL_NOT_FOUND", "التصنيف غير موجود");
    }
    return mobileServerError(error, "LABEL_UPDATE_FAILED", "تعذّر تعديل التصنيف");
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;
  if (auth.session.role !== "admin") {
    return mobileError(403, "ADMIN_REQUIRED", "حذف التصنيف متاح للإدارة فقط");
  }
  try {
    const { id } = await params;
    await deleteLabel(id);
    return mobileData({ ok: true });
  } catch (error) {
    return mobileServerError(error, "LABEL_DELETE_FAILED", "تعذّر حذف التصنيف");
  }
}
