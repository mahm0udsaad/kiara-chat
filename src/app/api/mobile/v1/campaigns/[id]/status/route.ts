import { after } from "next/server";
import { authorizeMobileRequest, mobileData, mobileError } from "@/lib/mobile/http";
import { setCampaignStatus, drainCampaigns, type CampaignStatus } from "@/lib/campaigns";

export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;
  const { id } = await params;
  const b = (await request.json().catch(() => ({}))) as { status?: string };
  const status = b.status as CampaignStatus;
  if (status !== "active" && status !== "paused") return mobileError(400, "BAD_STATUS", "حالة غير صالحة.");
  await setCampaignStatus(id, status);
  if (status === "active") after(() => drainCampaigns().catch(() => undefined));
  return mobileData({ ok: true });
}
