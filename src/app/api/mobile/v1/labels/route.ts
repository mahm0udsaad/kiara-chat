import { createLabel, LABEL_COLORS, listLabels } from "@/lib/labels";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";
import type { Label, LabelColor } from "@/lib/types";

type CreateLabelPayload = {
  name?: unknown;
  color?: unknown;
};

function sameLabelName(label: Label, name: string) {
  return label.name.localeCompare(name, "ar", { sensitivity: "base" }) === 0;
}

/** Create a shared classification without leaving the conversation sheet. */
export async function POST(request: Request) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  const payload = (await request.json().catch(() => null)) as CreateLabelPayload | null;
  const name = typeof payload?.name === "string" ? payload.name.trim() : "";
  const color = payload?.color;

  if (!name || name.length > 40) {
    return mobileError(
      400,
      "INVALID_LABEL_NAME",
      "اكتبي اسمًا للتصنيف لا يزيد عن ٤٠ حرفًا",
    );
  }
  if (typeof color !== "string" || !LABEL_COLORS.includes(color as LabelColor)) {
    return mobileError(400, "INVALID_LABEL_COLOR", "لون التصنيف غير صالح");
  }

  try {
    const existing = (await listLabels()).find((label) => sameLabelName(label, name));
    if (existing) return mobileData({ label: existing, created: false });

    const label = await createLabel(auth.session.userId, name, color as LabelColor);
    return mobileData({ label, created: true }, 201);
  } catch (error) {
    // Two employees may type the same new label at once. The unique constraint
    // chooses one winner; the other receives and selects that same label.
    if (error instanceof Error && error.message.includes("duplicate key")) {
      const existing = (await listLabels()).find((label) => sameLabelName(label, name));
      if (existing) return mobileData({ label: existing, created: false });
    }
    return mobileServerError(error, "LABEL_CREATE_FAILED", "تعذّر إنشاء التصنيف");
  }
}
