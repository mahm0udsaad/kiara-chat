import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { getConversationMessages } from "@/lib/inbox";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getKiaraSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const messages = await getConversationMessages(id);
  return NextResponse.json({ messages });
}
