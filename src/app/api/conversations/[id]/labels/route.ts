import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { denyIfRouted } from "@/lib/conversation-access";
import {
  getConversationLabelIds,
  listLabels,
  setConversationLabels,
} from "@/lib/labels";
import { CONVERSATION_EVENTS, recordConversationEvent } from "@/lib/audit";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const denied = await denyIfRouted(id, session);
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  const labelIds = Array.isArray(body?.labelIds) ? (body.labelIds as string[]) : [];
  try {
    const [before, available] = await Promise.all([
      getConversationLabelIds(id),
      listLabels(),
    ]);
    await setConversationLabels(session.userId, id, labelIds);
    const added = labelIds.filter((labelId) => !before.includes(labelId));
    const removed = before.filter((labelId) => !labelIds.includes(labelId));
    if (added.length || removed.length) {
      const byId = new Map(available.map((label) => [label.id, label.name]));
      const named = (ids: string[]) => ids.map((labelId) => byId.get(labelId) ?? labelId);
      await recordConversationEvent(
        id,
        CONVERSATION_EVENTS.labelsChanged,
        {
          userId: session.userId,
          teamMemberId: session.teamMemberId,
          role: session.role,
        },
        { added: named(added), removed: named(removed) },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to set labels" },
      { status: 500 }
    );
  }
}
