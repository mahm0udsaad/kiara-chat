import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { setDriverActive } from "@/lib/dispatch";

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
  const isActive = Boolean(body?.isActive);
  try {
    await setDriverActive(id, isActive);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to update driver" },
      { status: 500 }
    );
  }
}
