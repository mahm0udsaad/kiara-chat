import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { releaseConversation } from "@/lib/interactions";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  await releaseConversation(id);
  return NextResponse.json({ ok: true });
}
