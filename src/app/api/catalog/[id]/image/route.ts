import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { getCatalogItem } from "@/lib/catalog";

export const runtime = "nodejs";

/**
 * GET /api/catalog/[id]/image — the service photo, proxied.
 *
 * The photos live on Rekaz's CDN, which sends no CORS headers, so the composer
 * cannot read the bytes itself to stage them as an attachment. Fetching here
 * keeps it same-origin. Only the URL already stored on the row is ever
 * fetched — the id is the input, never a caller-supplied URL.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  let item;
  try {
    item = await getCatalogItem(id);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "تعذّر تحميل الصورة" },
      { status: 500 }
    );
  }
  if (!item?.imageUrl) {
    return NextResponse.json({ error: "لا توجد صورة لهذه الخدمة" }, { status: 404 });
  }

  try {
    const upstream = await fetch(item.imageUrl, { cache: "no-store" });
    if (!upstream.ok) {
      return NextResponse.json({ error: "تعذّر تحميل الصورة" }, { status: 502 });
    }
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": sniffImageType(bytes),
        // Private: it is behind a staff session, but it never changes per user.
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "تعذّر تحميل الصورة" }, { status: 502 });
  }
}

/**
 * Rekaz serves every photo as `application/octet-stream` from a `.webp` URL —
 * and the bytes behind that name are often PNG. Neither the header nor the
 * extension can be trusted, so read the magic number and let the browser get
 * a type it will actually decode.
 */
function sniffImageType(bytes: Uint8Array): string {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  // "RIFF" .... "WEBP"
  if (starts(0x52, 0x49, 0x46, 0x46) && [0x57, 0x45, 0x42, 0x50].every((b, i) => bytes[8 + i] === b))
    return "image/webp";
  return "application/octet-stream";
}
