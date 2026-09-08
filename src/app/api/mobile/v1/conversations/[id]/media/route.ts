/**
 * POST /api/mobile/v1/conversations/[id]/media — send a photo, video,
 * document, or voice note from the phone.
 *
 * New clients commit a file already uploaded through the signed-URL endpoint,
 * so large videos never cross Vercel. Multipart remains for older app builds.
 */
import { replyDenialFor } from "@/lib/conversation-reply-access";
import { getConversationById } from "@/lib/inbox";
import { sendMediaReply } from "@/lib/interactions";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";
import { maxMediaBytesForContentType } from "@/lib/storage-media";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MAX_CAPTION_LENGTH = 1_024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

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
    const denial = replyDenialFor(conversation, {
      role: auth.session.role,
      teamMemberId: auth.session.teamMemberId,
    });
    if (denial) {
      return mobileError(denial.status, denial.code, denial.message);
    }

    const requestContentType = request.headers.get("content-type") ?? "";
    let caption: string;
    let voiceNote: boolean;
    let idempotencyKey: string;
    let media:
      | { buffer: Buffer; contentType: string; filename: string | null }
      | {
          storagePath: string;
          sizeBytes: number;
          contentType: string;
          filename: string | null;
        };

    if (requestContentType.toLowerCase().includes("application/json")) {
      const body = (await request.json().catch(() => null)) as {
        caption?: unknown;
        contentType?: unknown;
        filename?: unknown;
        idempotencyKey?: unknown;
        sizeBytes?: unknown;
        storagePath?: unknown;
        voiceNote?: unknown;
      } | null;
      const contentType =
        typeof body?.contentType === "string" ? body.contentType : "";
      const storagePath =
        typeof body?.storagePath === "string" ? body.storagePath : "";
      const sizeBytes = Number(body?.sizeBytes);
      caption =
        typeof body?.caption === "string"
          ? body.caption.trim().slice(0, MAX_CAPTION_LENGTH)
          : "";
      voiceNote = body?.voiceNote === true;
      idempotencyKey = String(body?.idempotencyKey ?? "");
      if (
        !contentType ||
        !storagePath ||
        !Number.isSafeInteger(sizeBytes) ||
        sizeBytes <= 0
      ) {
        return mobileError(400, "INVALID_MEDIA", "بيانات الملف غير مكتملة");
      }
      media = {
        storagePath,
        sizeBytes,
        contentType,
        filename:
          typeof body?.filename === "string"
            ? body.filename.trim().slice(0, 255) || null
            : null,
      };
    } else {
      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        return mobileError(
          400,
          "INVALID_FORM_DATA",
          "الطلب يجب أن يكون multipart/form-data",
        );
      }
      const file = form.get("file");
      if (!(file instanceof File) || file.size === 0) {
        return mobileError(400, "EMPTY_FILE", "لم يتم اختيار ملف");
      }
      const contentType = file.type || "application/octet-stream";
      const sizeLimit = maxMediaBytesForContentType(contentType);
      if (file.size > sizeLimit) {
        return mobileError(
          413,
          "FILE_TOO_LARGE",
          `الملف أكبر من الحد المسموح (${sizeLimit / (1024 * 1024)} ميجابايت)`,
        );
      }
      caption = ((form.get("caption") as string | null) ?? "")
        .trim()
        .slice(0, MAX_CAPTION_LENGTH);
      voiceNote = form.get("voiceNote") === "true";
      idempotencyKey = String(form.get("idempotencyKey") ?? "");
      media = {
        buffer: Buffer.from(await file.arrayBuffer()),
        contentType,
        filename: file.name || null,
      };
    }

    if (!UUID.test(idempotencyKey)) {
      return mobileError(
        400,
        "INVALID_IDEMPOTENCY_KEY",
        "idempotencyKey must be a UUID",
      );
    }
    if (
      voiceNote &&
      !media.contentType.toLowerCase().startsWith("audio/")
    ) {
      return mobileError(
        400,
        "NOT_AUDIO",
        "الملاحظة الصوتية يجب أن تكون ملفًا صوتيًا",
      );
    }

    const result = await sendMediaReply(
      id,
      {
        email: auth.session.email,
        teamMemberId: auth.session.teamMemberId,
      },
      media,
      caption,
      { ptt: voiceNote, clientRequestId: idempotencyKey }
    );

    return mobileData(
      {
        conversationId: id,
        messageId: result.messageId,
        deliveryStatus: result.sent ? "sent" : "queued",
      },
      202
    );
  } catch (error) {
    return mobileServerError(
      error,
      "CONVERSATION_MEDIA_FAILED",
      "تعذّر إرسال الملف"
    );
  }
}
