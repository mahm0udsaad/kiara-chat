import { after } from "next/server";
import { authorizeMobileRequest, mobileData, mobileError } from "@/lib/mobile/http";
import { isSegment, segmentCounts, SEGMENTS, type Segment } from "@/lib/broadcast";
import { createCampaign, listCampaigns, drainCampaigns } from "@/lib/campaigns";

export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;
  const [campaigns, counts] = await Promise.all([listCampaigns(), segmentCounts()]);
  return mobileData({ campaigns, segments: SEGMENTS, segmentCounts: counts });
}

export async function POST(request: Request) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const contentSid = typeof b.contentSid === "string" ? b.contentSid : "";
  const templateName = typeof b.templateName === "string" ? b.templateName : "";
  const category = typeof b.category === "string" ? b.category : "MARKETING";
  const segment: Segment = typeof b.segment === "string" && isSegment(b.segment) ? b.segment : "all";
  if (!contentSid.startsWith("HX")) return mobileError(400, "BAD_TEMPLATE", "قالب غير صالح.");
  const campaign = await createCampaign({
    contentSid, templateName, category, segment, createdBy: auth.session.email ?? null,
  });
  after(() => drainCampaigns().catch(() => undefined));
  return mobileData({ campaign });
}
