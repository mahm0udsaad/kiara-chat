/**
 * POST /api/mobile/v1/conversations/[id]/media — send a photo, a document, or
 * a voice note from the phone.
 *
 * Multipart rather than base64 JSON, for the same reason the web route is:
 * the phone streams the file off disk instead of inflating it by a third on
 * the way up. The assignment rule from the reply route is repeated here on
 * purpose — an upload must not become a way into a thread someone else holds.
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
import { MAX_MEDIA_BYTES } from "@/lib/storage-media";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MAX_CAPTION_LENGTH = 1_024;

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
    return mobileError(400, "EMPTY_FILE", "لم يتم اختيار ملف");
  }
  if (file.size > MAX_MEDIA_BYTES) {
    return mobileError(
      413,
      "FILE_TOO_LARGE",
      "الملف أكبر من الحد المسموح (20 ميجابايت)"
    );
  }

  const caption = ((form.get("caption") as string | null) ?? "")
    .trim()
    .slice(0, MAX_CAPTION_LENGTH);
  // Only audio captured with the microphone becomes a WhatsApp voice note; an
  // audio file picked from storage stays an ordinary attachment.
  const voiceNote = form.get("voiceNote") === "true";
  const contentType = file.type || "application/octet-stream";
  if (voiceNote && !contentType.toLowerCase().startsWith("audio/")) {
    return mobileError(
      400,
      "NOT_AUDIO",
      "الملاحظة الصوتية يجب أن تكون ملفًا صوتيًا"
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
    const denial = replyDenialFor(conversation, {
      role: auth.session.role,
      teamMemberId: auth.session.teamMemberId,
    });
    if (denial) {
      return mobileError(denial.status, denial.code, denial.message);
    }

    const result = await sendMediaReply(
      id,
      {
        email: auth.session.email,
        teamMemberId: auth.session.teamMemberId,
      },
      {
        buffer: Buffer.from(await file.arrayBuffer()),
        contentType,
        filename: file.name || null,
      },
      caption,
      { ptt: voiceNote }
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
