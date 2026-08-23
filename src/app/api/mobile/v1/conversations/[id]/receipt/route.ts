import { saveBookingReceipt } from "@/lib/booking-receipt";
import { getConversationById } from "@/lib/inbox";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";
import { MAX_MEDIA_BYTES } from "@/lib/storage-media";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Upload and persist the invoice/receipt attached to a booking conversation. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return mobileError(
      400,
      "INVALID_FORM_DATA",
      "الطلب يجب أن يكون multipart/form-data"
    );
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return mobileError(400, "EMPTY_RECEIPT", "اختاري صورة الفاتورة أو ملف PDF");
  }
  if (file.size > MAX_MEDIA_BYTES) {
    return mobileError(
      413,
      "RECEIPT_TOO_LARGE",
      "الفاتورة أكبر من الحد المسموح (20 ميجابايت)"
    );
  }

  const contentType = (file.type || "application/octet-stream")
    .toLowerCase()
    .split(";")[0]
    .trim();
  if (!contentType.startsWith("image/") && contentType !== "application/pdf") {
    return mobileError(
      415,
      "UNSUPPORTED_RECEIPT_TYPE",
      "الفاتورة يجب أن تكون صورة أو ملف PDF"
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
        "Conversation not found"
      );
    }
    if (
      auth.session.role !== "admin" &&
      conversation.assigned_to !== auth.session.teamMemberId
    ) {
      return mobileError(
        conversation.assigned_to ? 403 : 409,
        conversation.assigned_to
          ? "CONVERSATION_ASSIGNED_TO_ANOTHER_EMPLOYEE"
          : "CONVERSATION_NOT_TAKEN",
        conversation.assigned_to
          ? "Only the assigned employee can attach a receipt"
          : "Take the conversation before attaching a receipt"
      );
    }

    const receipt = await saveBookingReceipt({
      conversation,
      buffer: Buffer.from(await file.arrayBuffer()),
      contentType,
      originalFilename: file.name || null,
      uploadedBy: auth.session.userId,
    });
    return mobileData({ receipt }, 201);
  } catch (error) {
    return mobileServerError(
      error,
      "BOOKING_RECEIPT_FAILED",
      "تعذّر حفظ الفاتورة"
    );
  }
}
