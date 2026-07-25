import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { listSavedReplies, createSavedReply } from "@/lib/saved-replies";

export async function GET() {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ savedReplies: await listSavedReplies() });
}

export async function POST(request: Request) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const title = (body?.title as string | undefined)?.trim();
  const text = (body?.body as string | undefined)?.trim();
  if (!title || !text) {
    return NextResponse.json({ error: "Title and body required" }, { status: 400 });
  }
  try {
    const savedReply = await createSavedReply(session.userId, title, text);
    return NextResponse.json({ ok: true, savedReply });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to save reply" },
      { status: 500 }
    );
  }
}
