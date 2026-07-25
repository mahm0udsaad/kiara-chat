import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { listNotes, addNote } from "@/lib/notes";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  return NextResponse.json({ notes: await listNotes(id) });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const text = (body?.body as string | undefined)?.trim();
  if (!text) return NextResponse.json({ error: "Empty note" }, { status: 400 });
  try {
    const note = await addNote(session.userId, id, text);
    return NextResponse.json({ ok: true, note });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to add note" },
      { status: 500 }
    );
  }
}
