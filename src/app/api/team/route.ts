import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { listTeam, createTeamMember } from "@/lib/team";

async function requireAdminSession() {
  const session = await getKiaraSession();
  if (!session) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (session.role !== "admin") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session };
}

export async function GET() {
  const { error } = await requireAdminSession();
  if (error) return error;
  return NextResponse.json({ team: await listTeam() });
}

export async function POST(request: Request) {
  const { error } = await requireAdminSession();
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const email = ((body?.email as string) ?? "").trim();
  const password = (body?.password as string) ?? "";
  const fullName = ((body?.fullName as string) ?? "").trim();
  const role = body?.role === "admin" ? "admin" : "agent";

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "بريد إلكتروني غير صالح" }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json(
      { error: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" },
      { status: 400 }
    );
  }
  if (!fullName) {
    return NextResponse.json({ error: "اسم الموظف مطلوب" }, { status: 400 });
  }

  try {
    const member = await createTeamMember({ email, password, fullName, role });
    return NextResponse.json({ ok: true, member });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "تعذّر إنشاء الحساب" },
      { status: 400 }
    );
  }
}
