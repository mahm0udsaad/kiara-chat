import { NextResponse } from "next/server";
import { provisionFieldStaffAccount, type FieldStaffRole } from "@/lib/field-staff";
import { getKiaraSession } from "@/lib/tenant";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ role: string; id: string }> }
) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { role: rawRole, id } = await params;
  if (rawRole !== "specialist" && rawRole !== "driver") {
    return NextResponse.json({ error: "الدور غير صحيح" }, { status: 400 });
  }
  const body = await request.json().catch(() => ({}));
  const password = typeof body?.password === "string" ? body.password : "";
  try {
    const account = await provisionFieldStaffAccount({
      role: rawRole as FieldStaffRole,
      rosterId: id,
      password,
    });
    return NextResponse.json({ ok: true, account });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "تعذّر إنشاء الدخول" },
      { status: 400 }
    );
  }
}
