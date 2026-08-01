/**
 * POST /api/conversations/[id]/media — send an image, document or voice note.
 * Takes multipart/form-data so the browser streams the file up instead of us
 * inflating it to base64 client-side.
 */
import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { denyIfRouted } from "@/lib/conversation-access";
import { sendMediaReply } from "@/lib/interactions";
import { MAX_MEDIA_BYTES } from "@/lib/storage-media";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const denied = await denyIfRouted(id, session);
  if (denied) return denied;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "لم يتم اختيار ملف" }, { status: 400 });
  }
  if (file.size > MAX_MEDIA_BYTES) {
    return NextResponse.json(
      { error: "الملف أكبر من الحد المسموح (20 ميجابايت)" },
      { status: 413 }
    );
  }

  const caption = ((form.get("caption") as string | null) ?? "").trim();
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const teamMemberId = session.teamMemberId;
    const result = await sendMediaReply(
      id,
      { email: session.email, teamMemberId },
      {
        buffer,
        contentType: file.type || "application/octet-stream",
        filename: file.name || null,
      },
      caption
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "تعذّر إرسال الملف" },
      { status: 500 }
    );
  }
}
