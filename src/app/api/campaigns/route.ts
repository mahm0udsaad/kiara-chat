/**
 * Campaigns (استهدافات). All staff.
 * GET  → every campaign with live sent/remaining counts.
 * POST → create a campaign (template + segment) and send its first batch now.
 */
import { NextResponse } from "next/server";
import { after } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { isSegment, type Segment } from "@/lib/broadcast";
import { createCampaign, listCampaigns, drainCampaigns } from "@/lib/campaigns";

export const maxDuration = 60;

export async function GET() {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ campaigns: await listCampaigns() });
}

export async function POST(request: Request) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const contentSid = typeof b.contentSid === "string" ? b.contentSid : "";
  const templateName = typeof b.templateName === "string" ? b.templateName : "";
  const category = typeof b.category === "string" ? b.category : "MARKETING";
  const segment: Segment =
    typeof b.segment === "string" && isSegment(b.segment) ? b.segment : "all";
  if (!contentSid.startsWith("HX")) {
    return NextResponse.json({ error: "قالب غير صالح." }, { status: 400 });
  }

  const campaign = await createCampaign({
    contentSid,
    templateName,
    category,
    segment,
    createdBy: session.email ?? null,
  });
  // Send the first batch off the response path so the app gets an immediate
  // reply; the daily cron carries the rest.
  after(() => drainCampaigns().catch(() => undefined));
  return NextResponse.json({ campaign });
}
