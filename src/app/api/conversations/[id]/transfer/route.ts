import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { transferConversation } from "@/lib/interactions";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const target = body?.targetTeamMemberId as string | undefined;
  if (!target) {
    return NextResponse.json({ error: "targetTeamMemberId required" }, { status: 400 });
  }
  const teamMemberId = session.teamMemberId;
  if (!teamMemberId) {
    return NextResponse.json({ error: "Not a Kiara agent" }, { status: 403 });
  }
  try {
    const conversation = await transferConversation(id, teamMemberId, target);
    return NextResponse.json({ ok: true, conversation });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to transfer" },
      { status: 500 }
    );
  }
}
