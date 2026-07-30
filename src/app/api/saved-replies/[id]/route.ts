import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { deleteSavedReply, updateSavedReply } from "@/lib/saved-replies";

/** Editing/removing a template is owner/manager-only — it's shared by the team. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const patch: { title?: string; body?: string } = {};
  if (typeof body?.title === "string") patch.title = body.title;
  if (typeof body?.body === "string") patch.body = body.body;
  if (patch.title !== undefined && !patch.title.trim())
    return NextResponse.json({ error: "العنوان مطلوب" }, { status: 400 });
  if (patch.body !== undefined && !patch.body.trim())
    return NextResponse.json({ error: "نص الرسالة مطلوب" }, { status: 400 });

  try {
    return NextResponse.json({ ok: true, savedReply: await updateSavedReply(id, patch) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "تعذّر التحديث" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  try {
    await deleteSavedReply(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "تعذّر الحذف" },
      { status: 500 }
    );
  }
}
