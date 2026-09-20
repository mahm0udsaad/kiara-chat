/**
 * Admin-only broadcast control.
 *
 * GET  /api/broadcasts/[key]?segment=all  → status + per-segment counts
 * POST /api/broadcasts/[key]              → send the next batch to a segment
 *        body: { segment?, action?: "sync" }  ("sync" refreshes the audience
 *        from recent bookings instead of sending)
 *
 * The client drives the send by polling POST until a segment is exhausted or
 * the daily cap is hit — keeping a paid, outward-facing blast under a human's
 * eye and trivially resumable across the days a large list spans.
 */
import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { isTemplateKey } from "@/lib/templates";
import {
  broadcastStatus,
  sendBroadcastBatch,
  syncAudienceFromReservations,
  isSegment,
  type Segment,
} from "@/lib/broadcast";

export const maxDuration = 60;

async function requireAdmin() {
  const session = await getKiaraSession();
  if (!session) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (session.role !== "admin") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session };
}

function segmentOf(request: Request): Segment {
  const raw = new URL(request.url).searchParams.get("segment") ?? "all";
  return isSegment(raw) ? raw : "all";
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { error } = await requireAdmin();
  if (error) return error;
  const { key } = await params;
  if (!isTemplateKey(key)) {
    return NextResponse.json({ error: "قالب غير معروف" }, { status: 404 });
  }
  return NextResponse.json(await broadcastStatus(key, segmentOf(request)));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { error } = await requireAdmin();
  if (error) return error;
  const { key } = await params;
  if (!isTemplateKey(key)) {
    return NextResponse.json({ error: "قالب غير معروف" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    segment?: string;
    action?: string;
    /** Exactly the numbers the employee ticked, when she picked them herself. */
    phones?: unknown;
  };
  const phones = Array.isArray(body.phones)
    ? body.phones.filter((phone): phone is string => typeof phone === "string" && Boolean(phone.trim()))
    : undefined;
  const segment: Segment =
    body.segment && isSegment(body.segment) ? body.segment : segmentOf(request);

  try {
    if (body.action === "sync") {
      const result = await syncAudienceFromReservations();
      return NextResponse.json({
        synced: result.audience,
        status: await broadcastStatus(key, segment),
      });
    }
    // An empty selection is a real answer — she ticked nobody — and must not
    // be read as "send to the whole segment".
    if (phones && !phones.length) {
      return NextResponse.json(
        { error: "اختاري رقمًا واحدًا على الأقل قبل الإرسال" },
        { status: 400 },
      );
    }
    return NextResponse.json(await sendBroadcastBatch(key, segment, phones));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "تعذّر الإرسال" },
      { status: 400 },
    );
  }
}
