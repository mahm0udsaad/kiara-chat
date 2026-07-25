import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { getMyTeamMemberId, takeConversation } from "@/lib/interactions";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const teamMemberId = await getMyTeamMemberId(session.userId);
  if (!teamMemberId) {
    return NextResponse.json({ error: "Not a Kiara agent" }, { status: 403 });
  }
  try {
    const conversation = await takeConversation(id, teamMemberId);
    return NextResponse.json({ ok: true, conversation });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to take" },
      { status: 500 }
    );
  }
}
