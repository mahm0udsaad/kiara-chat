import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { isTemplateKey } from "@/lib/templates";
import { getBroadcastAnalytics } from "@/lib/broadcast-analytics";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const session = await getKiaraSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { key } = await params;
  if (!isTemplateKey(key)) {
    return NextResponse.json({ error: "قالب غير معروف" }, { status: 404 });
  }

  try {
    const analytics = await getBroadcastAnalytics(key);
    return NextResponse.json(analytics);
  } catch (err) {
    const message = err instanceof Error ? err.message : "تعذّر جلب الإحصائيات";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
