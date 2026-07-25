import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { setConversationLabels } from "@/lib/labels";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const labelIds = Array.isArray(body?.labelIds) ? (body.labelIds as string[]) : [];
  try {
    await setConversationLabels(session.userId, id, labelIds);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to set labels" },
      { status: 500 }
    );
  }
}
