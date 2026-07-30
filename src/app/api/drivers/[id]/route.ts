import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { updateDriver, type RosterPatch } from "@/lib/dispatch";

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
  const patch: RosterPatch = {};
  if (typeof body?.fullName === "string") patch.fullName = body.fullName;
  if (typeof body?.phone === "string") patch.phone = body.phone;
  if (typeof body?.isActive === "boolean") patch.isActive = body.isActive;
  if (patch.fullName !== undefined && !patch.fullName.trim())
    return NextResponse.json({ error: "الاسم مطلوب" }, { status: 400 });

  try {
    const driver = await updateDriver(id, patch);
    return NextResponse.json({ ok: true, driver });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to update driver" },
      { status: 500 }
    );
  }
}
