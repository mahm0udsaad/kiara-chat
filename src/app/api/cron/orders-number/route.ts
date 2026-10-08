/**
 * GET /api/cron/orders-number — is the orders number still connected?
 *
 * A failed order notification already raises the alarm, but on a quiet day no
 * send fails because none is attempted, and the first to find the number down
 * is the next dispatch. This asks the engine every 30 minutes (Vercel Cron, see
 * `vercel.json`) so حنان and وسيله hear about a drop before an order is lost.
 * The once-per-outage bookkeeping is shared with the send path, so an outage
 * noticed both ways is still announced once.
 *
 * Auth accepts `Authorization: Bearer <CRON_SECRET>` (what Vercel Cron sends)
 * or `x-cron-secret`, matching the other cron routes.
 */
import { checkOrdersNumber } from "@/lib/orders-number";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = request.headers.get("authorization")?.trim();
  if (bearer === `Bearer ${secret}`) return true;
  return request.headers.get("x-cron-secret")?.trim() === secret;
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    console.error("[cron/orders-number] CRON_SECRET is not set");
    return Response.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  if (!authorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return Response.json({ ok: true, ...(await checkOrdersNumber()) });
  } catch (error) {
    console.error("[cron/orders-number] check failed", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Check failed" },
      { status: 500 },
    );
  }
}
