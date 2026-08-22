import { canViewConversation } from "@/lib/conversation-meta";
import { getConversationById } from "@/lib/inbox";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";
import { addNote, listNotes } from "@/lib/notes";

/**
 * Internal notes on a conversation — staff-only, never sent to the customer.
 *
 * The web drawer has had these since the beginning ("ملاحظات داخلية — لا تُرسل
 * للعميل") and the phone did not, which meant a note written on the floor had
 * to wait for someone to reach a laptop.
 *
 *   GET  — every note on the thread, oldest first.
 *   POST — add one. Body: { body: string }
 *
 * Visibility follows the inbox: a thread routed to a colleague is invisible
 * here, notes included.
 */
export const MAX_NOTE_CHARS = 2000;

async function authorizeNoteAccess(request: Request, id: string) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return { response: auth.response } as const;

  const viewer = {
    isAdmin: auth.session.role === "admin",
    teamMemberId: auth.session.teamMemberId,
  };
  const conversation = await getConversationById(id, viewer);
  if (
    !conversation ||
    !canViewConversation({ metadata: conversation.metadata }, viewer)
  ) {
    return {
      response: mobileError(
        404,
        "CONVERSATION_NOT_FOUND",
        "Conversation not found",
      ),
    } as const;
  }
  return { session: auth.session } as const;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await authorizeNoteAccess(request, id);
  if (access.response) return access.response;

  try {
    return mobileData({ notes: await listNotes(id) });
  } catch (error) {
    return mobileServerError(
      error,
      "NOTES_FAILED",
      "تعذّر تحميل الملاحظات الداخلية",
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await authorizeNoteAccess(request, id);
  if (access.response) return access.response;

  const payload = (await request.json().catch(() => null)) as {
    body?: unknown;
  } | null;
  const text = typeof payload?.body === "string" ? payload.body.trim() : "";
  if (!text) {
    return mobileError(400, "EMPTY_NOTE", "اكتبي الملاحظة أولاً");
  }
  if (text.length > MAX_NOTE_CHARS) {
    return mobileError(400, "NOTE_TOO_LONG", "الملاحظة طويلة جدًا");
  }

  try {
    const note = await addNote(access.session.userId, id, text);
    return mobileData({ note }, 201);
  } catch (error) {
    return mobileServerError(error, "NOTE_FAILED", "تعذّر حفظ الملاحظة");
  }
}
