import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { denyIfRouted } from "@/lib/conversation-access";
import { getConversationMessages, MESSAGE_PAGE_SIZE } from "@/lib/inbox";

/**
 * GET /api/conversations/[id]/messages — one page, oldest first within the page.
 *
 * `limit` caps the page (defaults to the opening page size) and `before` is the
 * ISO `created_at` of the oldest message already on screen, so scrolling up
 * walks backwards through the thread.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getKiaraSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const denied = await denyIfRouted(id, session);
  if (denied) return denied;

  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : MESSAGE_PAGE_SIZE;
  const before = url.searchParams.get("before");

  const { messages, hasMore } = await getConversationMessages(id, { limit, before });
  return NextResponse.json({ messages, hasMore });
}
