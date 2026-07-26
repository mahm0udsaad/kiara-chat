import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { setTeamMemberActive, resetTeamMemberPassword } from "@/lib/team";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  try {
    if (typeof body?.isActive === "boolean") {
      await setTeamMemberActive(id, body.isActive);
    }
    if (typeof body?.password === "string" && body.password) {
      if (body.password.length < 6) {
        return NextResponse.json(
          { error: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" },
          { status: 400 }
        );
      }
      if (!body?.userId) {
        return NextResponse.json({ error: "userId مطلوب" }, { status: 400 });
      }
      await resetTeamMemberPassword(body.userId as string, body.password as string);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "تعذّر التحديث" },
      { status: 400 }
    );
  }
}
