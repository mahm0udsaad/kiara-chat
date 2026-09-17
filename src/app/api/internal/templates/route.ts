/**
 * Operator path for templates and campaigns, for when nobody is holding the app.
 *
 * The Meta token only exists inside the deployment, so creating a template or
 * starting a campaign from a terminal has to happen here. Auth is the Supabase
 * service-role key as Bearer: whoever holds it can already rewrite every table
 * these actions touch, so this grants nothing new.
 *
 * GET  → templates with their live approval status.
 * GET ?action=segment_counts → audience size per recency segment, as the
 *        campaign send path will read it (`customers.metadata.last_booking_at`,
 *        not a live Rekaz query — call sync_audience first if that matters).
 * GET ?action=repeat_idle&minBookings=2&idleDays=5 → repeat bookers who have
 *        gone quiet: reads `rekaz_reservations` directly, so it's live and
 *        needs no prior sync.
 * POST { action: "create_template", name, body, imagePath, category? }
 *        imagePath is an object already in the whatsapp-media bucket.
 * POST { action: "sync_audience" }
 *        folds `rekaz_reservations` into `customers.metadata.last_booking_at`
 *        / `next_booking_at`, same as the broadcast screen's "sync" button.
 *        Segments are only as fresh as the last call of this.
 * POST { action: "start_campaign", templateName, language?, segment?, customerIds? }
 *        refuses unless Meta has approved the template; sends the first batch.
 *        customerIds, if given, targets exactly that list instead of `segment`
 *        (segment is then kept only as a label on the campaign).
 */
import { timingSafeEqual } from "crypto";

import {
  isSegment,
  repeatIdleCustomers,
  segmentCounts,
  syncAudienceFromReservations,
  type Segment,
} from "@/lib/broadcast";
import { createCampaign, drainCampaigns } from "@/lib/campaigns";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { WHATSAPP_MEDIA_BUCKET } from "@/lib/storage-media";
import {
  createTemplate,
  listTemplatesWithStatus,
  type TemplateCategory,
} from "@/lib/transport/content";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NAME_RE = /^[a-z0-9_]{1,512}$/;

function authorized(request: Request): boolean {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const header = request.headers.get("authorization")?.trim() ?? "";
  if (!key || !header.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice(7));
  const expected = Buffer.from(key);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const fail = (status: number, error: string) => Response.json({ error }, { status });

export async function GET(request: Request) {
  if (!authorized(request)) return fail(401, "Unauthorized");
  const action = new URL(request.url).searchParams.get("action");
  if (action === "segment_counts") {
    try {
      return Response.json({ segmentCounts: await segmentCounts() });
    } catch (e) {
      return fail(502, e instanceof Error ? e.message : "segment count failed");
    }
  }
  if (action === "repeat_idle") {
    const url = new URL(request.url);
    const minBookings = Math.max(1, Number(url.searchParams.get("minBookings") ?? 2) || 2);
    const idleDays = Math.max(0, Number(url.searchParams.get("idleDays") ?? 5) || 5);
    try {
      const customers = await repeatIdleCustomers(minBookings, idleDays);
      return Response.json({ minBookings, idleDays, count: customers.length, customers });
    } catch (e) {
      return fail(502, e instanceof Error ? e.message : "repeat_idle failed");
    }
  }
  try {
    return Response.json({ templates: await listTemplatesWithStatus() });
  } catch (e) {
    return fail(502, e instanceof Error ? e.message : "template list failed");
  }
}

export async function POST(request: Request) {
  if (!authorized(request)) return fail(401, "Unauthorized");
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  if (b.action === "create_template") {
    const name = typeof b.name === "string" ? b.name.trim() : "";
    const body = typeof b.body === "string" ? b.body.trim() : "";
    const imagePath = typeof b.imagePath === "string" ? b.imagePath.trim() : "";
    const category = (typeof b.category === "string" ? b.category : "MARKETING") as TemplateCategory;
    if (!NAME_RE.test(name)) return fail(400, "bad name");
    if (!body) return fail(400, "body required");
    if (!imagePath) return fail(400, "imagePath required");

    const { data, error } = await getAdminSupabaseClient()
      .storage.from(WHATSAPP_MEDIA_BUCKET)
      .createSignedUrl(imagePath, 7 * 24 * 60 * 60);
    if (error || !data?.signedUrl) return fail(400, "image not found in bucket");

    try {
      const created = await createTemplate({
        name,
        language: "ar",
        category,
        contentType: "media",
        body,
        mediaUrl: data.signedUrl,
      });
      return Response.json({ sid: created.sid, name: created.name, status: "pending" });
    } catch (e) {
      return fail(400, e instanceof Error ? e.message : "template create failed");
    }
  }

  if (b.action === "sync_audience") {
    try {
      const result = await syncAudienceFromReservations();
      return Response.json({ audience: result.audience, segmentCounts: await segmentCounts() });
    } catch (e) {
      return fail(500, e instanceof Error ? e.message : "audience sync failed");
    }
  }

  if (b.action === "start_campaign") {
    const templateName = typeof b.templateName === "string" ? b.templateName.trim() : "";
    const language = typeof b.language === "string" ? b.language : "ar";
    const segment: Segment =
      typeof b.segment === "string" && isSegment(b.segment) ? b.segment : "all";
    const customerIds = Array.isArray(b.customerIds)
      ? b.customerIds.filter((id): id is string => typeof id === "string" && id.length > 0)
      : null;
    if (Array.isArray(b.customerIds) && (!customerIds || customerIds.length === 0)) {
      return fail(400, "customerIds must be a non-empty array of strings");
    }
    const template = (await listTemplatesWithStatus()).find(
      (t) => t.name === templateName && t.language === language,
    );
    if (!template) return fail(404, "template not found");
    if (template.status !== "approved") {
      return fail(409, `template is ${template.status}${template.rejectionReason ? `: ${template.rejectionReason}` : ""}`);
    }
    const campaign = await createCampaign({
      contentSid: template.sid,
      templateName: template.name,
      category: template.category ?? "MARKETING",
      segment,
      customerIds,
      createdBy: "ops",
    });
    try {
      return Response.json({ campaign, firstBatch: await drainCampaigns() });
    } catch (e) {
      return Response.json({ campaign, drainError: e instanceof Error ? e.message : String(e) });
    }
  }

  return fail(400, "unknown action");
}
