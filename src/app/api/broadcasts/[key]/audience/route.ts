/**
 * GET /api/broadcasts/[key]/audience — who this campaign would reach, and who
 * the employee may tick.
 *
 * The segment narrows by booking recency; these filters narrow by what the
 * inbox knows — label, conversation status, booking stage, contact outcome —
 * so the campaign screen can pick an audience the same way the chat list is
 * read. Nothing here sends.
 */
import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { isTemplateKey } from "@/lib/templates";
import { isSegment, listAudience, type AudienceFilters, type Segment } from "@/lib/broadcast";
import { isBookingStage } from "@/lib/booking-stage";
import { isContactOutcome } from "@/lib/contact-outcome";
import type { CsStatus } from "@/lib/types";

export const maxDuration = 60;

const CS_STATUSES = new Set<CsStatus>(["open", "waiting", "resolved"]);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { key } = await params;
  if (!isTemplateKey(key)) {
    return NextResponse.json({ error: "قالب غير معروف" }, { status: 404 });
  }

  const url = new URL(request.url);
  const rawSegment = url.searchParams.get("segment") ?? "all";
  const segment: Segment = isSegment(rawSegment) ? rawSegment : "all";
  const status = url.searchParams.get("status");
  const bookingStage = url.searchParams.get("bookingStage");
  const contactOutcome = url.searchParams.get("contactOutcome");
  const filters: AudienceFilters = {
    labelId: url.searchParams.get("labelId") || null,
    status: status && CS_STATUSES.has(status as CsStatus) ? (status as CsStatus) : null,
    bookingStage: bookingStage && isBookingStage(bookingStage) ? bookingStage : null,
    contactOutcome:
      contactOutcome && isContactOutcome(contactOutcome) ? contactOutcome : null,
    search: url.searchParams.get("search"),
    includeSent: url.searchParams.get("includeSent") === "1",
  };

  try {
    return NextResponse.json(await listAudience(key, segment, filters));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "تعذّر تحميل القائمة" },
      { status: 400 },
    );
  }
}
