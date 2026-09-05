/** Pause or resume a campaign; resuming also nudges a batch out immediately. */
import { NextResponse, after } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import { setCampaignStatus, drainCampaigns, type CampaignStatus } from "@/lib/campaigns";

export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const b = (await request.json().catch(() => ({}))) as { status?: string };
  const status = b.status as CampaignStatus;
  if (status !== "active" && status !== "paused") {
    return NextResponse.json({ error: "حالة غير صالحة." }, { status: 400 });
  }
  await setCampaignStatus(id, status);
  if (status === "active") after(() => drainCampaigns().catch(() => undefined));
  return NextResponse.json({ ok: true });
}
