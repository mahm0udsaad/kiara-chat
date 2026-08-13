/**
 * GET /api/cron/inbox-danger — alert the team about chats that have gone late.
 *
 * The other two inbox alerts ride on an event (a message arrived). This one is
 * about time passing, which nothing observes on its own, so it needs a caller
 * on a schedule. Any scheduler works — Vercel Cron, Supabase `pg_cron` via
 * `pg_net`, or a plain crontab on the engine VPS — as long as it presents the
 * shared secret. Run it about once a minute; the danger line is six.
 *
 * Auth accepts either `Authorization: Bearer <CRON_SECRET>` (what Vercel Cron
 * sends) or `x-cron-secret`, which is easier from `pg_net` and curl.
 */
import { sweepDangerConversations } from "@/lib/inbox-notifications";

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
    // Failing loudly beats a sweep that silently never runs.
    console.error("[cron/inbox-danger] CRON_SECRET is not set");
    return Response.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  if (!authorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await sweepDangerConversations();
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error("[cron/inbox-danger] sweep failed", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Sweep failed" },
      { status: 500 }
    );
  }
}
