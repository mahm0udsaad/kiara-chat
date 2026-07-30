import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { createCatalogItem, listCatalog } from "@/lib/catalog";

/** Any signed-in member can read the catalogue — they send it to customers. */
export async function GET(request: Request) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // The composer only offers what's on sale; the settings manager wants it all.
  const availableOnly = new URL(request.url).searchParams.get("all") !== "1";
  try {
    return NextResponse.json({ items: await listCatalog({ availableOnly }) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "تعذّر تحميل الباقات" },
      { status: 500 }
    );
  }
}

/** Adding a service/package is owner/manager-only. */
export async function POST(request: Request) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const name = (body?.name as string | undefined)?.trim();
  if (!name) return NextResponse.json({ error: "الاسم مطلوب" }, { status: 400 });

  const rawPrice = body?.price;
  const price =
    rawPrice === null || rawPrice === undefined || rawPrice === ""
      ? null
      : Number(rawPrice);
  if (price !== null && (!Number.isFinite(price) || price < 0))
    return NextResponse.json({ error: "السعر غير صحيح" }, { status: 400 });

  try {
    const item = await createCatalogItem({
      name,
      description: (body?.description as string | undefined) ?? "",
      price,
      category: (body?.category as string | undefined) ?? "",
    });
    return NextResponse.json({ ok: true, item });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "تعذّرت الإضافة" },
      { status: 500 }
    );
  }
}
