/**
 * POST /api/conversations/[id]/read — clear the unread badge once an agent
 * has the thread open.
 */
import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { markConversationRead } from "@/lib/interactions";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    await markConversationRead(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed" },
      { status: 500 }
    );
  }
}
