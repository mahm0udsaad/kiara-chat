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
  if (!contentSid.startsWith("HX") && !contentSid.startsWith("meta:")) {
    return mobileError(400, "BAD_TEMPLATE", "قالب غير صالح.");
  }
  // Ticked women, when the employee picked the audience by hand. The queue
  // already honours this list; leaving it out sends to the whole segment, so
  // an empty array has to be refused rather than silently widened.
  const customerIds = Array.isArray(b.customerIds)
    ? b.customerIds.filter(
        (id): id is string => typeof id === "string" && id.trim().length > 0,
      )
    : null;
  if (Array.isArray(b.customerIds) && !customerIds?.length) {
    return mobileError(400, "EMPTY_AUDIENCE", "اختاري عميلة واحدة على الأقل.");
  }
  const campaign = await createCampaign({
    contentSid, templateName, category, segment,
    customerIds,
    createdBy: auth.session.email ?? null,
  });
  after(() => drainCampaigns().catch(() => undefined));
  return mobileData({ campaign });
}
