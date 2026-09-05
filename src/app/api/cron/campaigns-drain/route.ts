/**
 * GET /api/cron/campaigns-drain — send the day's batch for active campaigns.
 *
 * Called on a schedule (Vercel Cron) so campaigns continue with the app closed.
 * Auth: the shared CRON_SECRET, as Bearer or x-cron-secret.
 */
import { drainCampaigns } from "@/lib/campaigns";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (request.headers.get("authorization")?.trim() === `Bearer ${secret}`) return true;
  return request.headers.get("x-cron-secret")?.trim() === secret;
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return Response.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (!authorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return Response.json({ ok: true, ...(await drainCampaigns()) });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "drain failed" },
      { status: 500 },
    );
  }
}
