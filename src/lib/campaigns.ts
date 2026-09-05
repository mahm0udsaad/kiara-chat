/**
 * Campaigns (استهدافات) — send an approved template to a customer segment,
 * server-side, over the days the daily cap spans.
 *
 * No new tables: the campaign list lives in `restaurants.metadata.campaigns`,
 * per-customer send-state on `customers.metadata.broadcasts` keyed by campaign
 * id (the same store the number-notice broadcast uses), and the template itself
 * lives in Twilio. The drain is called both immediately on start (so the first
 * batch goes out at once) and by a daily cron (so it continues untouched).
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import { twilioTransport, isTwilioConfigured } from "@/lib/transport";
import { randomUUID } from "crypto";
import {
  loadAllCustomers,
  inSegment,
  globalSentLast24h,
  DAILY_SEND_CAP,
  type Segment,
  type CustomerRow,
  type BroadcastMark,
} from "@/lib/broadcast";

const BATCH_BUDGET = 150; // sends per drain call — ~45s at typical latency, inside the 60s budget

export type CampaignStatus = "active" | "paused" | "done";

export interface Campaign {
  id: string;
  contentSid: string;
  templateName: string;
  category: string;
  segment: Segment;
  status: CampaignStatus;
  createdBy: string | null;
  createdAt: string;
}

export interface CampaignView extends Campaign {
  total: number;
  sent: number;
  failed: number;
  remaining: number;
}

const marksOf = (row: CustomerRow) =>
  (row.metadata?.broadcasts as Record<string, BroadcastMark>) ?? {};

async function readCampaigns(): Promise<Campaign[]> {
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("restaurants")
    .select("metadata")
    .eq("id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  const meta = (data?.metadata as Record<string, unknown> | null) ?? {};
  return (meta.campaigns as Campaign[]) ?? [];
}

async function writeCampaigns(campaigns: Campaign[]): Promise<void> {
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("restaurants")
    .select("metadata")
    .eq("id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  const meta = (data?.metadata as Record<string, unknown> | null) ?? {};
  await admin
    .from("restaurants")
    .update({ metadata: { ...meta, campaigns } })
    .eq("id", KIARA_RESTAURANT_ID);
}

function view(campaign: Campaign, rows: CustomerRow[]): CampaignView {
  const inSeg = rows.filter((r) => inSegment(r, campaign.segment));
  let sent = 0;
  let failed = 0;
  for (const r of inSeg) {
    const m = marksOf(r)[campaign.id];
    if (m?.status === "sent") sent += 1;
    else if (m?.status === "failed") failed += 1;
  }
  return {
    ...campaign,
    total: inSeg.length,
    sent,
    failed,
    remaining: inSeg.length - sent,
  };
}

export async function listCampaigns(): Promise<CampaignView[]> {
  const [campaigns, rows] = await Promise.all([readCampaigns(), loadAllCustomers()]);
  return campaigns
    .map((c) => view(c, rows))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function createCampaign(input: {
  contentSid: string;
  templateName: string;
  category: string;
  segment: Segment;
  createdBy: string | null;
}): Promise<Campaign> {
  const campaigns = await readCampaigns();
  const campaign: Campaign = {
    id: randomUUID(),
    contentSid: input.contentSid,
    templateName: input.templateName,
    category: input.category,
    segment: input.segment,
    status: "active",
    createdBy: input.createdBy,
    createdAt: new Date().toISOString(),
  };
  await writeCampaigns([campaign, ...campaigns]);
  return campaign;
}

export async function setCampaignStatus(
  id: string,
  status: CampaignStatus,
): Promise<void> {
  const campaigns = await readCampaigns();
  await writeCampaigns(campaigns.map((c) => (c.id === id ? { ...c, status } : c)));
}

export interface DrainSummary {
  sent: number;
  failed: number;
  dailyRemaining: number;
  campaigns: { id: string; sent: number; remaining: number; status: CampaignStatus }[];
}

/**
 * Send for every active campaign until the number's daily cap or this call's
 * budget is spent. Idempotent per customer per campaign, so repeated cron ticks
 * never double-send. Called by the daily cron and once, inline, when a campaign
 * starts.
 */
export async function drainCampaigns(): Promise<DrainSummary> {
  if (!isTwilioConfigured()) throw new Error("Twilio is not configured.");
  const admin = getAdminSupabaseClient();

  const campaigns = await readCampaigns();
  const active = campaigns.filter((c) => c.status === "active");
  const rows = await loadAllCustomers();

  let budget = Math.max(0, DAILY_SEND_CAP - globalSentLast24h(rows));
  let totalSent = 0;
  let totalFailed = 0;
  const perCampaign: DrainSummary["campaigns"] = [];
  let campaignsChanged = false;

  for (const campaign of active) {
    let sent = 0;
    const pending = rows.filter(
      (r) => inSegment(r, campaign.segment) && marksOf(r)[campaign.id]?.status !== "sent",
    );
    for (const row of pending) {
      if (budget <= 0 || totalSent >= BATCH_BUDGET) break;
      const phone = (row.phone_number || "").trim();
      if (!phone) continue;
      budget -= 1;

      let mark: BroadcastMark;
      try {
        const res = await twilioTransport.sendTemplate(phone, campaign.contentSid, {});
        mark = { status: "sent", sid: res.providerMessageId || null, at: new Date().toISOString() };
        sent += 1;
        totalSent += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        mark = { status: "failed", error: message.slice(0, 300), at: new Date().toISOString() };
        totalFailed += 1;
      }
      const meta = (row.metadata as Record<string, unknown> | null) ?? {};
      const broadcasts = (meta.broadcasts as Record<string, BroadcastMark>) ?? {};
      // Keep the in-memory row current so budget/segment math stays right within
      // this pass and the campaign view below is accurate.
      row.metadata = { ...meta, broadcasts: { ...broadcasts, [campaign.id]: mark } };
      await admin.from("customers").update({ metadata: row.metadata }).eq("id", row.id);
    }

    const v = view(campaign, rows);
    // A campaign with nothing left to send is finished.
    let status = campaign.status;
    if (v.remaining <= 0) {
      status = "done";
      campaignsChanged = true;
    }
    perCampaign.push({ id: campaign.id, sent, remaining: v.remaining, status });
    if (budget <= 0 || totalSent >= BATCH_BUDGET) break;
  }

  if (campaignsChanged) {
    const done = new Set(perCampaign.filter((p) => p.status === "done").map((p) => p.id));
    await writeCampaigns(
      campaigns.map((c) => (done.has(c.id) ? { ...c, status: "done" as const } : c)),
    );
  }

  return {
    sent: totalSent,
    failed: totalFailed,
    dailyRemaining: Math.max(0, budget),
    campaigns: perCampaign,
  };
}
