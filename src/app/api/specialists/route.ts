import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { listSpecialists, createSpecialist } from "@/lib/dispatch";
import { isNationalityCode } from "@/lib/nationalities";

export async function GET() {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ specialists: await listSpecialists() });
}

export async function POST(request: Request) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const fullName = (body?.fullName as string | undefined)?.trim();
  const phone = (body?.phone as string | undefined)?.trim() || null;
  const rawNationality = (body?.nationality as string | undefined)?.trim();
  const nationality =
    rawNationality && isNationalityCode(rawNationality) ? rawNationality : null;
  if (!fullName) return NextResponse.json({ error: "الاسم مطلوب" }, { status: 400 });

  try {
    const specialist = await createSpecialist(session.userId, fullName, phone, nationality);
    return NextResponse.json({ ok: true, specialist });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to create specialist" },
      { status: 500 }
    );
  }
}
