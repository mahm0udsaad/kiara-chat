import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { updateCatalogItem, type CatalogPatch } from "@/lib/catalog";

/**
 * Edit one service/package. Owner/manager-only — this row also feeds the bot's
 * menu context and the parent app, so a wrong price here travels.
 */
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
  const patch: CatalogPatch = {};
  if (typeof body?.name === "string") patch.name = body.name;
  if (typeof body?.description === "string") patch.description = body.description;
  if (typeof body?.category === "string") patch.category = body.category;
  if (typeof body?.isAvailable === "boolean") patch.isAvailable = body.isAvailable;
  if (body?.price !== undefined) {
    const price = body.price === null || body.price === "" ? null : Number(body.price);
    if (price !== null && (!Number.isFinite(price) || price < 0))
      return NextResponse.json({ error: "السعر غير صحيح" }, { status: 400 });
    patch.price = price;
  }
  if (patch.name !== undefined && !patch.name.trim())
    return NextResponse.json({ error: "الاسم مطلوب" }, { status: 400 });

  try {
    return NextResponse.json({ ok: true, item: await updateCatalogItem(id, patch) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "تعذّر التحديث" },
      { status: 500 }
    );
  }
}
