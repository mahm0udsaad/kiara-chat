/**
 * Admin-only broadcast control.
 *
 * GET  /api/broadcasts/[key]  → status (counts, daily headroom)
 * POST /api/broadcasts/[key]  → send the next batch, return updated status
 *
 * The client drives the send by polling POST until `remaining` hits 0 or the
 * daily cap is reached — which keeps a paid, outward-facing blast under a
 * human's eye rather than firing autonomously, and makes it trivially
 * resumable across the days a large list will span.
 */
import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { isTemplateKey } from "@/lib/templates";
import { broadcastStatus, sendBroadcastBatch } from "@/lib/broadcast";

export const maxDuration = 60;

async function requireAdmin() {
  const session = await getKiaraSession();
  if (!session) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (session.role !== "admin") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { error } = await requireAdmin();
  if (error) return error;
  const { key } = await params;
  if (!isTemplateKey(key)) {
    return NextResponse.json({ error: "قالب غير معروف" }, { status: 404 });
  }
  return NextResponse.json(await broadcastStatus(key));
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { error } = await requireAdmin();
  if (error) return error;
  const { key } = await params;
  if (!isTemplateKey(key)) {
    return NextResponse.json({ error: "قالب غير معروف" }, { status: 404 });
  }
  try {
    return NextResponse.json(await sendBroadcastBatch(key));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "تعذّر الإرسال" },
      { status: 400 },
    );
  }
}
